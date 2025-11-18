const response = await fetch("https://api.spotify.com/v1/artists/6V8L1msbb4Hl8psDzB58bi/top-tracks?market=US", {
	headers: {
		"Authorization": `Bearer ${token}`
	}
});