import fetch from 'node-fetch'
import { Parser } from 'xml2js'

const fetchProfile = async (url) => {
  const userURL = /(?:http|https):\/\/(steamcommunity\.com)\/(profiles|id)\/(.*)/i.exec(url)
  if (userURL?.[1] == 'steamcommunity.com') {
    const resp = await fetch(url+'?xml=1')
    const xml = await resp.text()
    
    const profile = await new Parser().parseStringPromise(xml)
    
    if (profile.profile) {
      return profile.profile
    } else {
      console.error('Error finding steam id. Malformed URL?', url)
      return false
    }
    
  } else {
    console.error('Error finding steam id. Malformed URL?', url)
    return false
  }
  
}

exports.handler = async function(event, context, opts = {}) {

  if(event.body) opts = JSON.parse(event.body)
  else opts = event.queryStringParameters

  if(!opts.steamURL && !event?.queryStringParameters?.steamURL) return { statusCode: 500, body: JSON.stringify({ error: `Couldn't find steamURL submitted. Probably my fault, sorry!`})}
  const profile = await fetchProfile(opts.steamURL)
  
  if (profile?.steamID64) {
    
    const resp = await fetch(`http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?steamid=${profile.steamID64}&key=${process.env.steam_api}&include_appinfo=true&include_played_free_games=${opts.includeFree || false}&include_free_sub=${opts.includeFree || false}`)
    const body = await resp.json()
    
    let games = body?.response?.games
    if(games?.length > 0 && games[0].appid) {
      
      if(!opts.includeUnplayed) games = games.filter(game => game.playtime_forever > 0)
      
      let opml = `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0">
<head>
  <title>Steam Updates</title>
  <dateCreated>${new Date()}</dateCreated>
  <ownerName>Zack Boehm's Steam owned games OPML generator</ownerName>
  <ownerId>https://steam-rss.zackboe.hm - https://github.com/zackboe/steam-rss</ownerId>
</head>
<body>
  <outline text="Steam Updates">`
opml += games.map(game => `
    <outline text="${game.name}" title="${game.name}" type="rss" xmlUrl="https://store.steampowered.com/feeds/news/app/${game.appid}/" htmlUrl="https://store.steampowered.com/news/app/${game.appid}/"/>`
).join('')
opml += `
  </outline>
</body>
</opml>
`

      console.log(`Serving ${profile.steamID} (${profile.steamID64}) an opml with ${games.length} games`)

      // Assume no js, direct URL/form submission
      if(!event.body) return { statusCode: 200, headers: { 'Content-Type': 'text/xml', 'Content-Disposition': 'attachment; filename=steam-updates.opml' }, body: opml }

      return {
        statusCode: 200,
        body: JSON.stringify({
          profile: { name: profile.steamID, avatar: profile.avatarFull?.[0] },
          games: games.length,
          opml: opml
        }, null, 2)
      }
      
    } else {
      return {
        statusCode: 409,
        body: JSON.stringify({
          profile: { name: profile.steamID, avatar: profile.avatarFull?.[0] },
          error: `<p>Couldn't get a list of your owned games. Is your <a href="https://steamcommunity.com/id/me/edit/settings">profile & game details public?</a></p>`
        })
      }
    }
    
    
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `<p>Couldn't find your Steam profile. Use the format <code>https://steamcommunity.com/id/gabelogannewell</code> or <code>https://steamcommunity.com/profiles/76561197960287930</code></p>`
      })
    }
  }
}