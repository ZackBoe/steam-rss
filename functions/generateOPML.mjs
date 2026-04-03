import got from 'got'
import { Parser } from 'xml2js'

const assetBase = `https://shared.steamstatic.com/store_item_assets/`

const fetchProfile = async (url) => {
  console.log('fetching profile')
  const userURL = /(?:http|https):\/\/(steamcommunity\.com)\/(profiles|id)\/(.*)/i.exec(url)
  if (userURL?.[1] == 'steamcommunity.com') {
    const resp = await got(url+'?xml=1')
    const profile = await new Parser().parseStringPromise(resp.body)
    
    if (profile.profile) {
      console.log(`Got profile ${profile.profile.steamID64} for ${profile.profile.realname}`)
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

const fetchWishlist = async (steamID) => {

  const wishlistData = await fetch(`https://api.steampowered.com/IWishlistService/GetWishlist/v1?steamid=${steamID}`).then(res => res.json())
  let wishlistIds = wishlistData.response.items.map(i => {
    return { appid: i.appid }
  })
  let wishlistIdGroups = []
  let wishlistItems = []
  while (wishlistIds.length) {
    wishlistIdGroups.push(wishlistIds.splice(0, 100))
  }
  
  console.log(`Got ${wishlistIdGroups.length} wishlist groups`)

  await Promise.all(wishlistIdGroups.slice(0,5).map(async (ids) => {
    const request = { "ids": ids, "context": { "country_code": "US" }, "data_request": { "include_assets": true } }
    const requestURL = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURI(JSON.stringify(request))}`
    const itemDetails = await fetch(requestURL)
    .then(res => res.json())
    
    const items = itemDetails.response.store_items.map(i => {
      return {
        appid: i.id,
        name: i.name,
        image: i?.assets ? `${assetBase}${i.assets.asset_url_format.replace('${FILENAME}', i.assets['header'])}` : null,
        wishlist: true
      }
    })

    wishlistItems = wishlistItems.concat(items)

  }))

  console.log(`Got ${wishlistItems.length} wishlist items with details`)

  return wishlistItems

}

exports.handler = async function(event, context, opts = {}) {

  if(event.body) opts = JSON.parse(event.body)
  else opts = event.queryStringParameters

  if(!opts.steamURL && !event?.queryStringParameters?.steamURL) return { statusCode: 500, body: JSON.stringify({ error: `Couldn't find steamURL submitted. Probably my fault, sorry!`})}
  console.log('fetching from steam')
  const profile = await fetchProfile(opts.steamURL)
  
  if (profile?.steamID64) {
    const body = await got(`http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?steamid=${profile.steamID64}&key=${process.env.steam_api}&include_appinfo=true&include_played_free_games=${opts.includeFree || false}&include_free_sub=${opts.includeFree || false}`).json();
    
    let games = body?.response?.games
    if(games?.length > 0 && games[0].appid) {
      
      if(!opts.includeUnplayed) games = games.filter(game => game.playtime_forever > 0)

      if(opts.includeWishlist) {
        const wishlist = await fetchWishlist(profile.steamID64[0])
        games = games.concat(wishlist)
      }
      
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
    <outline text="${game.name.replace('&', '&amp;')}" title="${game.name.replace('&', '&amp;')}" type="rss" xmlUrl="https://store.steampowered.com/feeds/news/app/${game.appid}/" htmlUrl="https://store.steampowered.com/news/app/${game.appid}/"/>`
).join('')
opml += `
  </outline>
</body>
</opml>
`

      console.log(`Serving ${profile.steamID} (${profile.steamID64}) an opml with ${games.length} games`)

      // Assume no js, direct URL/form submission
      if(!event.body) return { statusCode: 200, headers: { 'Content-Type': 'text/xml', 'Content-Disposition': 'attachment; filename=steam-updates.opml' }, body: opml }


      // Return OPML & games json for client filtering
      games = games.map(game => ({
        ...game,
        image: game.image ? game.image : `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
        store: `https://store.steampowered.com/app/${game.appid}/`
      }))

      games.sort((a, b) => { return b.playtime_forever - a.playtime_forever})

      let table = `<thead><tr><th class="no-sort">Image</th><th>Title</th><th class="no-sort">Preview <br>Feed</th>${opts.includeWishlist ? '<th>Owned</th>' : '' }<th>Playtime</th><th>Playtime <br>(Last 2 Weeks)</th><th>Include in OPML</th></tr></thead>`
      games.forEach(game => {
        table += `<tr data-appid="${game.appid}">
          <td><a ${game.wishlist ? 'class="wishlist"' : ''} href="${game.store}"><img src="${game.image}" onerror="this.onerror=null;this.src='https://steam-assets.netlify.app/assets/${game.appid}/header';" loading="lazy"></a></td>
          <td><a href="${game.store}">${game.name}</a></td>
          <td><a href="https://store.steampowered.com/news/app/${game.appid}"><img src="/link.svg"></a></td>
          ${opts.includeWishlist ? `<td>${game.wishlist ? 'Wishlisted' : 'In Library'}</td>` : '' }
          <td data-sort="${game.playtime_forever || 0}">${new Intl.NumberFormat().format(Number(game.playtime_forever/60 || 0).toFixed(2))} hours</td>
          <td data-sort="${game.playtime_2weeks || 0}">${new Intl.NumberFormat().format(Number(game.playtime_2weeks/60 || 0).toFixed(2))} hours</td>
          <td data-sort="1"><input type="checkbox" checked id="${game.appid}" name="${game.appid}" data-appid="${game.appid}" data-name="${game.name}"></td>
        </tr>`
      })
      table += '</tbody>'

      return {
        statusCode: 200,
        body: JSON.stringify({
          profile: { name: profile.steamID, avatar: profile.avatarFull?.[0] },
          count: games.length,
          games: games,
          table: table,
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