console.log("App loaded");

// ⚠️ Temporary access token – expires in 1 hour
const accessToken = "BQDDVV54CM4Gz62w2_queRaVFTQ5zoUOI0ym4Gtj6fduKlQenoAk2PDVGgPIJrsQoVdaRGrpH0W7rYM5Sfx8tyH__RSBqp-TAp77dc1mJyv9Yi6e1V8zezQvsYraalZz-Jrg07ck5ZA";

// Search button handling
document.getElementById("searchBtn").addEventListener("click", () => {
	const artist = document.getElementById("searchInput").value.trim();
	if (artist) searchArtist(artist);
});

// Main search function
async function searchArtist(name) {
	const resultsDiv = document.getElementById("results");
	resultsDiv.innerHTML = "Searching...";

	try {
		const response = await fetch(
			`https://api.spotify.com/v1/search?q=artist:${encodeURIComponent(name)}&type=artist&limit=50`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`
				}
			}
		);

		console.log("Status:", response.status);

		const data = await response.json();

		if (!data.artists || data.artists.items.length === 0) {
			resultsDiv.innerHTML = "No artist found";
			return;
		}

		// Create display items
		resultsDiv.innerHTML = data.artists.items
			.map(artist => `
                <div class="artist-item">
                    <strong>${artist.name}</strong><br>
                    Followers: ${artist.followers.total}<br>
                    Popularity: ${artist.popularity}<br><br>
                    <button onclick="getTopTracks('${artist.id}')">Get Top Tracks</button>
                </div>
                <br>
            `)
			.join("");

	} catch (error) {
		console.error(error);
		resultsDiv.innerHTML = "Error fetching artist";
	}
}

// Fetch top tracks
async function getTopTracks(artistId) {
	const resultsDiv = document.getElementById("results");
	resultsDiv.innerHTML = "Fetching top tracks...";

	try {
		const response = await fetch(
			`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`
				}
			}
		);

		const data = await response.json();
		console.log("Top tracks:", data);

		if (!data.tracks || data.tracks.length === 0) {
			resultsDiv.innerHTML = "No top tracks found";
			return;
		}

		resultsDiv.innerHTML = data.tracks
			.map(track => `
				<div class="track-item">
					<strong>${track.name}</strong><br>
					<a href="${track.external_urls.spotify}" target="_blank">Open in Spotify</a><br><br>
					<audio controls>
						<source src="${track.preview_url}" type="audio/mpeg">
						Your browser does not support the audio element.
					</audio><br><br>
					<button onclick="addToPlaylist('${track.uri}')">Add to Playlist</button>
				</div><br>
			`)
			.join("");

	} catch (error) {
		console.error(error);
		resultsDiv.innerHTML = "Error fetching top tracks";
	}
}

// Placeholder for playlist button
function addToPlaylist(uri) {
	console.log("Track added (temp):", uri);
	alert("Feature coming soon: Add to playlist");
}
