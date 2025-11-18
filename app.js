console.log("App loaded");

// Later we'll add OAuth login,
// search artists,
// get top tracks,
// add tracks to playlist, etc.

document.getElementById("searchBtn").addEventListener("click", () => {
	const artist = document.getElementById("searchInput").value;
	console.log("Searching for:", artist);

	// For now just print. We'll implement the real API soon.
	document.getElementById("results").innerText = "Searching for: " + artist;
});
