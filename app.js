console.log("TrackFinder loaded");

// ===========================================
// Config
// ===========================================
const AUTH_SERVER = 'https://trackfinder-9zqy.onrender.com';
const urlParams = new URLSearchParams(window.location.search);
const authCode = urlParams.get('code');

let accessToken = localStorage.getItem('access_token') || null;
let refreshToken = localStorage.getItem('refresh_token') || null;

const clientId = 'c9e5b2ef41844eb582938eb497f11339';
const redirectUri = 'http://127.0.0.1:5500/';

// ===========================================
// Utility: Extract Playlist ID from URL/URI/ID
// ===========================================
function extractPlaylistId(input) {
	if (!input) return '';
	input = input.trim();
	// Handle full Spotify URLs: https://open.spotify.com/playlist/XXXXX?si=...
	try {
		const url = new URL(input);
		const parts = url.pathname.split('/');
		const idx = parts.indexOf('playlist');
		if (idx !== -1 && parts[idx + 1]) {
			return parts[idx + 1];
		}
	} catch (e) { /* not a URL */ }
	// Handle Spotify URIs: spotify:playlist:XXXXX
	if (input.startsWith('spotify:playlist:')) {
		return input.split(':')[2];
	}
	// Already a raw ID
	return input;
}

// ===========================================
// Toast Notifications
// ===========================================
function showToast(message, type = 'info', duration = 4000) {
	const container = document.getElementById('toastContainer');
	if (!container) return;

	const toast = document.createElement('div');
	toast.className = `toast toast-${type}`;

	const icons = {
		success: '✓',
		error: '✕',
		info: 'ℹ'
	};

	toast.innerHTML = `<span style="font-size:16px;line-height:1">${icons[type] || icons.info}</span><span>${message}</span>`;
	container.appendChild(toast);

	setTimeout(() => {
		toast.classList.add('toast-removing');
		setTimeout(() => toast.remove(), 300);
	}, duration);
}

// ===========================================
// OAuth Token Management
// ===========================================
async function exchangeCodeForToken(code) {
	try {
		const resp = await fetch(`${AUTH_SERVER}/auth/exchange`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code })
		});
		const data = await resp.json();
		if (data.access_token) {
			accessToken = data.access_token;
			localStorage.setItem('access_token', data.access_token);
			if (data.refresh_token) {
				refreshToken = data.refresh_token;
				localStorage.setItem('refresh_token', data.refresh_token);
			}
				// Invalidate playlist cache when logging in
				cachedUserPlaylists = null;
			history.replaceState({}, document.title, window.location.pathname);
			showToast('Logged in successfully!', 'success');
			fetchAndDisplayUser();
			return true;
		} else {
			console.error('Token exchange failed', data);
			showToast('Login failed. Please try again.', 'error');
			return false;
		}
	} catch (err) {
		console.error('Exchange error', err);
		showToast('Connection error during login.', 'error');
		return false;
	}
}

async function refreshAccessToken() {
	if (!refreshToken) return false;
	try {
		const resp = await fetch(`${AUTH_SERVER}/auth/refresh`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ refresh_token: refreshToken })
		});
		const data = await resp.json();
		if (data.access_token) {
			accessToken = data.access_token;
			localStorage.setItem('access_token', data.access_token);
			return true;
		} else {
			console.error('Refresh failed', data);
			return false;
		}
	} catch (err) {
		console.error('Refresh error', err);
		return false;
	}
}

// Wrapper for Spotify API with auto-refresh on 401
async function spotifyFetch(url, opts = {}, retry = true) {
	if (!accessToken) {
		try { return new Response(null, { status: 401 }); }
		catch (e) { throw new Error('No access token'); }
	}

	opts.headers = opts.headers || {};
	opts.headers.Authorization = `Bearer ${accessToken}`;

	let resp = await fetch(url, opts);
	if (resp.status === 401 && retry && refreshToken) {
		const ok = await refreshAccessToken();
		if (ok) {
			opts.headers.Authorization = `Bearer ${accessToken}`;
			resp = await fetch(url, opts);
		}
	}
	return resp;
}

// ===========================================
// User Info
// ===========================================
async function fetchAndDisplayUser() {
	try {
		const user = await getCurrentUser();
		const nameEl = document.getElementById('userName');
		const avatarEl = document.getElementById('userAvatar');
		const infoEl = document.getElementById('userInfo');
		const loginBtn = document.getElementById('loginBtn');

		if (nameEl) nameEl.textContent = user.display_name || user.id;
		if (avatarEl && user.images && user.images.length) {
			avatarEl.src = user.images[0].url;
		}
		if (infoEl) infoEl.style.display = 'flex';
		if (loginBtn) loginBtn.style.display = 'none';
	} catch (e) {
		console.log('Could not fetch user info');
	}
}

// ===========================================
// Playlist State
// ===========================================
let playlistTracks = []; // { uri, name }
let addToTop = true;
let pendingSelectedUris = [];
let pendingSelectedNames = [];

// ===========================================
// Render: Artists
// ===========================================
function renderArtists(artists) {
	const resultsDiv = document.getElementById("results");
	resultsDiv.innerHTML = `<div class="results-topbar"><span id="resultsCount">${artists.length}</span> artists found</div>` +
		artists.map(a => `
		<div class="artist-item">
			<strong>${a.name}</strong><br>
			Followers: ${(a.followers.total || 0).toLocaleString()}<br>
			Popularity: ${a.popularity}<br><br>
			<button class="btn btn-outline get-top-btn" data-artist-id="${a.id}">Get Top Tracks</button>
		</div>
	`).join("");

	document.querySelectorAll('.get-top-btn').forEach(btn =>
		btn.addEventListener('click', e => getTopTracks(e.currentTarget.dataset.artistId))
	);
}

// ===========================================
// Render: Tracks
// ===========================================
function renderTracks(tracks) {
	const resultsDiv = document.getElementById("results");
	resultsDiv.innerHTML = `
		<div class="results-topbar"><span id="resultsCount">${tracks.length}</span> tracks</div>
		<div class="results-list">
			${tracks.map((track, idx) => {
		const img = (track.album && track.album.images && track.album.images[0]) ? track.album.images[0].url : '';
		const durSec = Math.floor((track.duration_ms || 0) / 1000);
		const dur = `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}`;
		const artists = track.artists.map(a => a.name).join(', ');
		return `
				<div class="track-row" data-index="${idx}">
					<div class="track-number">${idx + 1}</div>
					<img class="track-thumb" src="${img}" alt="${track.name}" loading="lazy" />
					<div class="track-title-wrap">
						<div class="track-title">${track.name}</div>
						<div class="track-artists">${artists}</div>
					</div>
					<div class="track-album">${track.album ? track.album.name : ''}</div>
					<div class="track-actions">
						<span class="track-duration">${dur}</span>
						<button class="add-btn" data-uri="${track.uri}" data-name="${encodeURIComponent(track.name)}">Add</button>
						<label><input type="checkbox" class="track-checkbox" data-uri="${track.uri}" data-name="${encodeURIComponent(track.name)}"></label>
					</div>
				</div>`;
	}).join('')}
		</div>`;

	resultsDiv.querySelectorAll('.add-btn[data-uri]').forEach(btn =>
		btn.addEventListener('click', e => {
			const uri = e.currentTarget.dataset.uri;
			const name = decodeURIComponent(e.currentTarget.dataset.name);
			addToPlaylist(uri, name);
		})
	);

	// checkbox handling: enable/disable Add Selected button
	const addSelectedBtn = document.getElementById('addSelectedBtn');
	function updateAddSelectedState() {
		const checked = document.querySelectorAll('.track-checkbox:checked').length;
		if (addSelectedBtn) addSelectedBtn.disabled = checked === 0;
	}

	resultsDiv.querySelectorAll('.track-checkbox').forEach(cb => {
		cb.addEventListener('change', () => {
			updateAddSelectedState();
		});
	});

	// initialize state
	updateAddSelectedState();
}

// ===========================================
// Search
// ===========================================
async function searchArtist(name) {
	const resultsDiv = document.getElementById("results");
	resultsDiv.innerHTML = '<div class="loading-state"><div class="spinner spinner-lg"></div><span>Searching…</span></div>';

	if (!accessToken) {
		resultsDiv.innerHTML = '<div class="loading-state"><span>Not authenticated. Please login with Spotify.</span></div>';
		return;
	}

	try {
		const response = await spotifyFetch(
			`https://api.spotify.com/v1/search?q=artist:${encodeURIComponent(name)}&type=artist&limit=50`
		);

		if (response.status === 401) {
			resultsDiv.innerHTML = '<div class="loading-state"><span>Session expired. Please login again.</span></div>';
			return;
		}

		const data = await response.json();

		if (!data.artists || !data.artists.items.length) {
			resultsDiv.innerHTML = '<div class="loading-state"><span>No artists found</span></div>';
			return;
		}

		renderArtists(data.artists.items);
	} catch (error) {
		console.error(error);
		resultsDiv.innerHTML = '<div class="loading-state"><span>Error searching artists</span></div>';
	}
}

// ===========================================
// Top Tracks
// ===========================================
async function getTopTracks(artistId) {
	const resultsDiv = document.getElementById("results");
	resultsDiv.innerHTML = '<div class="loading-state"><div class="spinner spinner-lg"></div><span>Fetching top tracks…</span></div>';

	if (!accessToken) {
		resultsDiv.innerHTML = '<div class="loading-state"><span>Not authenticated. Please login with Spotify.</span></div>';
		return;
	}


	try {
		const topNSelect = document.getElementById('topNSelect');
		const topN = topNSelect ? parseInt(topNSelect.value, 10) : 10;
		const tracks = await getArtistTracks(artistId, topN);
		if (!tracks || !tracks.length) {
			resultsDiv.innerHTML = '<div class="loading-state"><span>No top tracks found</span></div>';
			return;
		}
		renderTracks(tracks.slice(0, topN));
	} catch (error) {
		console.error(error);
		resultsDiv.innerHTML = '<div class="loading-state"><span>Error fetching top tracks</span></div>';
	}
}

// Fetch artist tracks up to `limit`. Uses top-tracks for <=10, otherwise gathers tracks from albums and ranks by popularity.
async function getArtistTracks(artistId, limit = 10) {
	// use top-tracks endpoint for common case
	if (limit <= 10) {
		const resp = await spotifyFetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`);
		if (!resp || resp.status !== 200) return [];
		const data = await resp.json();
		return data.tracks || [];
	}

	// collect album ids
	let albums = [];
	let url = `https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album,single,appears_on&limit=50`;
	const albumSeen = new Set();
	while (url && albums.length < 200) {
		const resp = await spotifyFetch(url);
		if (!resp || resp.status !== 200) break;
		const data = await resp.json();
		if (data.items) {
			for (const a of data.items) {
				if (!albumSeen.has(a.id)) {
					albumSeen.add(a.id);
					albums.push(a.id);
				}
			}
		}
		url = data.next || null;
	}

	// gather track ids from albums
	const trackIds = [];
	const trackSeen = new Set();
	for (const albumId of albums) {
		const resp = await spotifyFetch(`https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`);
		if (!resp || resp.status !== 200) continue;
		const data = await resp.json();
		if (!data.items) continue;
		for (const t of data.items) {
			if (t && t.id && !trackSeen.has(t.id)) {
				trackSeen.add(t.id);
				trackIds.push(t.id);
			}
		}
		if (trackIds.length >= limit * 4) break; // get some overshoot to allow ranking
	}

	if (!trackIds.length) return [];

	// fetch track details in batches to get popularity
	const fullTracks = [];
	for (let i = 0; i < trackIds.length; i += 50) {
		const chunk = trackIds.slice(i, i + 50);
		const resp = await spotifyFetch(`https://api.spotify.com/v1/tracks?ids=${chunk.join(',')}`);
		if (!resp || resp.status !== 200) continue;
		const data = await resp.json();
		if (data.tracks) fullTracks.push(...data.tracks.filter(Boolean));
	}

	// sort by popularity desc, fallback to keep order
	fullTracks.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
	return fullTracks.slice(0, limit);
}

// ===========================================
// Playlist Management
// ===========================================
function addToPlaylist(uri, name) {
	if (!playlistTracks.some(t => t.uri === uri)) {
		if (addToTop) {
			playlistTracks.unshift({ uri, name });
		} else {
			playlistTracks.push({ uri, name });
		}
		updatePlaylistUI();
		showToast(`Added "${name}"`, 'success', 2000);
	} else {
		showToast('Track already in playlist', 'info', 2000);
	}
}

function removeFromPlaylist(uri) {
	const track = playlistTracks.find(t => t.uri === uri);
	playlistTracks = playlistTracks.filter(t => t.uri !== uri);
	updatePlaylistUI();
	if (track) showToast(`Removed "${track.name}"`, 'info', 2000);
}

function updatePlaylistUI() {
	const countEl = document.getElementById('playlistCount');
	const listEl = document.getElementById('playlistList');
	if (countEl) countEl.textContent = playlistTracks.length;

	if (!listEl) return;

	if (!playlistTracks.length) {
		listEl.innerHTML = '<div class="empty-state small"><p>No tracks added yet</p></div>';
		attachPlaylistDragDrop();
		return;
	}

	listEl.innerHTML = playlistTracks.map((t, i) => `
		<div class="playlist-item" draggable="true" data-index="${i}" data-uri="${t.uri}">
			<span class="playlist-item-drag">⠿</span>
			<span class="playlist-item-name" title="${t.name}">${t.name}</span>
			<button class="remove-play-btn" data-uri="${t.uri}">Remove</button>
		</div>
	`).join('');

	listEl.querySelectorAll('.remove-play-btn').forEach(btn =>
		btn.addEventListener('click', e => removeFromPlaylist(e.currentTarget.dataset.uri))
	);

	attachPlaylistDragDrop();
}

// ===========================================
// Drag & Drop
// ===========================================
function attachPlaylistDragDrop() {
	const items = document.querySelectorAll('.playlist-item[draggable="true"]');
	let dragSrcIdx = null;
	items.forEach(item => {
		item.addEventListener('dragstart', e => {
			dragSrcIdx = Number(item.dataset.index);
			item.classList.add('dragging');
			e.dataTransfer.effectAllowed = 'move';
		});
		item.addEventListener('dragend', () => {
			item.classList.remove('dragging');
			dragSrcIdx = null;
			items.forEach(i => i.classList.remove('drag-over'));
		});
		item.addEventListener('dragover', e => {
			e.preventDefault();
			item.classList.add('drag-over');
		});
		item.addEventListener('dragleave', () => {
			item.classList.remove('drag-over');
		});
		item.addEventListener('drop', e => {
			e.preventDefault();
			item.classList.remove('drag-over');
			const dropIdx = Number(item.dataset.index);
			if (dragSrcIdx !== null && dragSrcIdx !== dropIdx) {
				const moved = playlistTracks.splice(dragSrcIdx, 1)[0];
				playlistTracks.splice(dropIdx, 0, moved);
				updatePlaylistUI();
			}
		});
	});
}

// ===========================================
// Spotify API Helpers (top-level)
// ===========================================
async function getCurrentUser() {
	const resp = await spotifyFetch('https://api.spotify.com/v1/me');
	if (!resp || resp.status !== 200) {
		throw new Error('Failed to fetch current user');
	}
	return resp.json();
}

async function createPlaylist(name, isPublic = true) {
	const me = await getCurrentUser();
	const resp = await spotifyFetch(`https://api.spotify.com/v1/users/${me.id}/playlists`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, public: !!isPublic })
	});
	if (!resp || (resp.status !== 201 && resp.status !== 200)) {
		const txt = await resp.text().catch(() => '');
		throw new Error('Create playlist failed: ' + txt);
	}
	return resp.json();
}

async function addTracksToPlaylist(playlistId, uris) {
	const resp = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ uris })
	});
	if (!resp || (resp.status !== 201 && resp.status !== 200)) {
		const txt = await resp.text().catch(() => '');
		throw new Error('Add tracks failed: ' + txt);
	}
	return resp.json();
}

async function fetchAllPlaylistTracks(playlistId) {
	let tracks = [];
	let offset = 0;
	while (true) {
		const resp = await spotifyFetch(
			`https://api.spotify.com/v1/playlists/${playlistId}/tracks?offset=${offset}&fields=items.track.uri,total,next&limit=100`
		);
		if (!resp || resp.status !== 200) break;
		const data = await resp.json();
		const items = data.items || [];
		if (!items.length) break;
		tracks.push(...items.map(item => item.track && item.track.uri).filter(Boolean));
		offset += items.length;
		if (!data.next) break;
	}
	return tracks;
}

// Return map of uri -> positions array for a playlist (so we can remove specific occurrences)
async function fetchPlaylistTrackPositions(playlistId) {
	const map = new Map();
	let offset = 0;
	while (true) {
		const resp = await spotifyFetch(
			`https://api.spotify.com/v1/playlists/${playlistId}/tracks?offset=${offset}&fields=items.track.uri,total,next&limit=100`
		);
		if (!resp || resp.status !== 200) break;
		const data = await resp.json();
		const items = data.items || [];
		if (!items.length) break;
		for (let i = 0; i < items.length; i++) {
			const uri = items[i] && items[i].track && items[i].track.uri;
			if (!uri) continue;
			const pos = offset + i;
			if (!map.has(uri)) map.set(uri, []);
			map.get(uri).push(pos);
		}
		offset += items.length;
		if (!data.next) break;
	}
	// convert to array of {uri, positions}
	const arr = [];
	for (const [uri, positions] of map.entries()) arr.push({ uri, positions });
	return arr;
}

// Remove tracks by specifying positions for each uri. Expects [{uri, positions:[...]}]
async function removeTracksFromPlaylistPositions(playlistId, tracksWithPositions) {
	const resp = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ tracks: tracksWithPositions })
	});
	if (!resp || (resp.status !== 200 && resp.status !== 201)) {
		const txt = await resp.text().catch(() => '');
		throw new Error('Remove tracks by positions failed: ' + txt);
	}
	return resp.json();
}

async function removeTracksFromPlaylist(playlistId, uris) {
	const resp = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ tracks: uris.map(uri => ({ uri })) })
	});
	if (!resp || (resp.status !== 200 && resp.status !== 201)) {
		const txt = await resp.text().catch(() => '');
		throw new Error('Remove tracks failed: ' + txt);
	}
	return resp.json();
}

// ===========================================
// Modal Helpers
// ===========================================
function openModal(id) {
	const modal = document.getElementById(id);
	if (modal) {
		modal.classList.add('open');
		modal.setAttribute('aria-hidden', 'false');
	}
}

function closeModal(id) {
	const modal = document.getElementById(id);
	if (modal) {
		modal.classList.remove('open');
		modal.setAttribute('aria-hidden', 'true');
	}
}

function openPlaylistModal(names = []) {
	const input = document.getElementById('playlistNameInput');
	if (!input) return;
	const suggestion = names.length ? `${names[0]} - Top Tracks` : 'My Playlist';
	input.value = suggestion;
	openModal('playlistModal');
	// Load user's playlists into the existing-playlist picker
	loadPickerPlaylists(['playlistPickerList'], ['playlistPickerSelectedId']);
	initPickerTabs();
	input.focus();
	input.select();
}

// ===========================================
// Playlist Picker System
// ===========================================
let cachedUserPlaylists = null;

async function fetchUserPlaylists() {
	if (cachedUserPlaylists) return cachedUserPlaylists;
	if (!accessToken) return [];
	let playlists = [];
	let url = 'https://api.spotify.com/v1/me/playlists?limit=50';
	while (url) {
		const resp = await spotifyFetch(url);
		if (!resp || resp.status !== 200) break;
		const data = await resp.json();
		if (data.items) {
			playlists.push(...data.items.map(p => ({
				id: p.id,
				name: p.name,
				tracks: p.tracks ? p.tracks.total : 0,
				image: (p.images && p.images.length) ? p.images[p.images.length > 1 ? 1 : 0].url : '',
				owner: p.owner ? p.owner.display_name : ''
			})));
		}
		url = data.next || null;
	}
	cachedUserPlaylists = playlists;
	return playlists;
}

function renderPickerList(listEl, hiddenInputId, playlists) {
	if (!listEl) return;
	if (!playlists.length) {
		listEl.innerHTML = '<div class="picker-empty">No playlists found. Log in first.</div>';
		return;
	}
	listEl.innerHTML = playlists.map(p => `
		<div class="picker-item" data-id="${p.id}" data-name="${p.name}">
			${p.image ? `<img class="picker-item-img" src="${p.image}" alt="" loading="lazy" />` : '<div class="picker-item-img"></div>'}
			<div class="picker-item-info">
				<div class="picker-item-name">${p.name}</div>
				<div class="picker-item-meta">${p.tracks} tracks · ${p.owner}</div>
			</div>
			<div class="picker-item-check"></div>
		</div>
	`).join('');

	// click to select
	listEl.querySelectorAll('.picker-item').forEach(item => {
		item.addEventListener('click', () => {
			// toggle selection in this list
			const wasSelected = item.classList.contains('selected');
			listEl.querySelectorAll('.picker-item').forEach(i => i.classList.remove('selected'));
			const hidden = document.getElementById(hiddenInputId);
			if (wasSelected) {
				// deselect
				if (hidden) hidden.value = '';
			} else {
				item.classList.add('selected');
				if (hidden) hidden.value = item.dataset.id;
			}
		});
	});
}

function initPickerTabs() {
	document.querySelectorAll('.picker-tabs').forEach(tabBar => {
		const tabs = tabBar.querySelectorAll('.picker-tab');
		const parent = tabBar.closest('.form-group');
		if (!parent) return;
		tabs.forEach(tab => {
			tab.addEventListener('click', (e) => {
				e.preventDefault();
				tabs.forEach(t => t.classList.remove('active'));
				tab.classList.add('active');
				const targetId = tab.dataset.target;
				parent.querySelectorAll('.picker-panel').forEach(p => p.classList.remove('active'));
				const targetPanel = document.getElementById(targetId);
				if (targetPanel) targetPanel.classList.add('active');
			});
		});
	});
}

async function loadPickerPlaylists(listIds, hiddenInputIds) {
	// Show loading in all lists
	listIds.forEach(id => {
		const el = document.getElementById(id);
		if (el) el.innerHTML = '<div class="picker-loading"><div class="spinner"></div> Loading playlists…</div>';
	});

	try {
		const playlists = await fetchUserPlaylists();
		listIds.forEach((id, i) => {
			const el = document.getElementById(id);
			renderPickerList(el, hiddenInputIds[i], playlists);
		});
	} catch (err) {
		console.error('Failed to load playlists:', err);
		listIds.forEach(id => {
			const el = document.getElementById(id);
			if (el) el.innerHTML = '<div class="picker-empty">Failed to load playlists. Try pasting a URL instead.</div>';
		});
	}
}

// ===========================================
// Delete Duplicates Logic
// ===========================================
async function handleDeleteDuplicates() {
	const pickerHidden = document.getElementById('dupSelectedPlaylistId');
	const playlistInput = document.getElementById('dupPlaylistIdInput');
	const refPickerHidden = document.getElementById('dupSelectedRefId');
	const refInput = document.getElementById('dupReferenceIdInput');
	const confirmBtn = document.getElementById('deleteDuplicatesConfirmBtn');

	// Prefer picker selection, fall back to URL input
	const rawPlaylistId = (pickerHidden && pickerHidden.value) || (playlistInput ? playlistInput.value : '');
	const rawRefId = (refPickerHidden && refPickerHidden.value) || (refInput ? refInput.value : '');

	const playlistId = extractPlaylistId(rawPlaylistId);
	const refId = extractPlaylistId(rawRefId);

	if (!playlistId) {
		showToast('Please select or enter a playlist.', 'error');
		return;
	}

	closeModal('deleteDuplicatesModal');
	if (confirmBtn) confirmBtn.disabled = true;

	const resultsEl = document.getElementById('results');
	if (resultsEl) resultsEl.innerHTML = '<div class="loading-state"><div class="spinner spinner-lg"></div><span>Fetching playlist tracks…</span></div>';

	try {
		// get positions so we can remove only duplicate instances (keep one)
		const playlistItems = await fetchPlaylistTrackPositions(playlistId);
		let tracks = playlistItems.map(p => p.uri);

		if (!tracks.length) {
			showToast('No tracks found in the playlist.', 'info');
			if (resultsEl) resultsEl.innerHTML = '<div class="loading-state"><span>No tracks found in this playlist.</span></div>';
			return;
		}

		let refTracks = null;
		if (refId) {
			const refItems = await fetchAllPlaylistTracks(refId);
			refTracks = new Set(refItems);
		}

		// Find duplicates
		let duplicates = [];
		if (refTracks) {
			// Remove all occurrences of tracks that exist in the reference playlist
			for (const it of playlistItems) {
				if (refTracks.has(it.uri)) duplicates.push({ uri: it.uri, positions: it.positions });
			}
		} else {
			// Remove true duplicates (keep first occurrence) by sending positions to delete
			for (const it of playlistItems) {
				if (it.positions && it.positions.length > 1) {
					// keep first position, remove the rest
					duplicates.push({ uri: it.uri, positions: it.positions.slice(1) });
				}
			}
		}

		if (!duplicates.length) {
			showToast('No duplicates found!', 'success');
			if (resultsEl) resultsEl.innerHTML = '<div class="loading-state"><span>✅ No duplicates found. Playlist is clean!</span></div>';
			return;
		}

		if (resultsEl) resultsEl.innerHTML = `<div class="loading-state"><div class="spinner spinner-lg"></div><span>Removing ${duplicates.length} duplicate(s)…</span></div>`;

		// Remove duplicates in batches (by tracks objects). Use positions-aware removal when positions given.
		for (let i = 0; i < duplicates.length; i += 50) {
			const chunk = duplicates.slice(i, i + 50);
			// if chunk items have 'positions' property, call positions-based remove
			if (chunk.length && chunk[0].positions) {
				await removeTracksFromPlaylistPositions(playlistId, chunk);
			} else {
				// fallback: remove by uri (this will remove all occurrences)
				const uris = chunk.map(c => c.uri);
				await removeTracksFromPlaylist(playlistId, uris);
			}
		}

		showToast(`Removed ${duplicates.length} duplicate(s)!`, 'success');
		if (resultsEl) resultsEl.innerHTML = `<div class="loading-state"><span>✅ Removed ${duplicates.length} duplicate track(s) from the playlist.</span></div>`;
	} catch (err) {
		console.error(err);
		showToast('Failed to delete duplicates: ' + (err.message || 'Unknown error'), 'error');
		if (resultsEl) resultsEl.innerHTML = '<div class="loading-state"><span>Error deleting duplicates. Check the console for details.</span></div>';
	} finally {
		if (confirmBtn) confirmBtn.disabled = false;
	}
}

// ===========================================
// Copy Playlist Logic
// ===========================================
async function handleCopyPlaylist() {
	const srcPickerHidden = document.getElementById('copySelectedSrcId');
	const srcInput = document.getElementById('sourcePlaylistIdInput');
	const tgtPickerHidden = document.getElementById('copySelectedTgtId');
	const tgtInput = document.getElementById('targetPlaylistIdInput');
	const orderDropdown = document.getElementById('copyOrderDropdown');
	const confirmBtn = document.getElementById('copyPlaylistConfirmBtn');
	if (!orderDropdown) return;

	// Prefer picker selection, fall back to URL input
	const rawSrc = (srcPickerHidden && srcPickerHidden.value) || (srcInput ? srcInput.value : '');
	const rawTgt = (tgtPickerHidden && tgtPickerHidden.value) || (tgtInput ? tgtInput.value : '');

	const src = extractPlaylistId(rawSrc);
	const tgt = extractPlaylistId(rawTgt);
	const order = orderDropdown.value;

	if (!src || !tgt) {
		showToast('Please select or enter both playlists.', 'error');
		return;
	}

	closeModal('copyPlaylistModal');
	if (confirmBtn) confirmBtn.disabled = true;

	const resultsEl = document.getElementById('results');
	if (resultsEl) resultsEl.innerHTML = '<div class="loading-state"><div class="spinner spinner-lg"></div><span>Fetching source playlist…</span></div>';

	try {
		let tracks = await fetchAllPlaylistTracks(src);

		if (!tracks.length) {
			showToast('No tracks found in source playlist.', 'info');
			if (resultsEl) resultsEl.innerHTML = '<div class="loading-state"><span>No tracks found in the source playlist.</span></div>';
			return;
		}

		const totalTracks = tracks.length;

		if (order === 'recently_added') {
			// Add one-by-one in reverse so "Recently Added" sort shows correct order
			if (resultsEl) resultsEl.innerHTML = `<div class="loading-state"><div class="spinner spinner-lg"></div><span>Adding ${totalTracks} tracks (recently added order)…<br><small>0 / ${totalTracks}</small></span></div>`;

			const reversed = [...tracks].reverse();
			for (let i = 0; i < reversed.length; i++) {
				await addTracksToPlaylist(tgt, [reversed[i]]);
				// Update progress
				const progressEl = resultsEl ? resultsEl.querySelector('small') : null;
				if (progressEl) progressEl.textContent = `${i + 1} / ${totalTracks}`;
			}
		} else if (order === 'reverse') {
			tracks = [...tracks].reverse();
			if (resultsEl) resultsEl.innerHTML = `<div class="loading-state"><div class="spinner spinner-lg"></div><span>Adding ${totalTracks} tracks (reverse order)…</span></div>`;
			for (let i = 0; i < tracks.length; i += 100) {
				await addTracksToPlaylist(tgt, tracks.slice(i, i + 100));
			}
		} else {
			// Original order — batch add
			if (resultsEl) resultsEl.innerHTML = `<div class="loading-state"><div class="spinner spinner-lg"></div><span>Adding ${totalTracks} tracks (original order)…</span></div>`;
			for (let i = 0; i < tracks.length; i += 100) {
				await addTracksToPlaylist(tgt, tracks.slice(i, i + 100));
			}
		}

		showToast(`Copied ${totalTracks} tracks successfully!`, 'success');
		if (resultsEl) resultsEl.innerHTML = `<div class="loading-state"><span>✅ Copied ${totalTracks} tracks to the target playlist.${order === 'recently_added' ? '<br><small>Sort by "Recently Added" in Spotify to see the correct order.</small>' : ''}</span></div>`;
	} catch (err) {
		console.error(err);
		showToast('Failed to copy playlist: ' + (err.message || 'Unknown error'), 'error');
		if (resultsEl) resultsEl.innerHTML = '<div class="loading-state"><span>Error copying playlist. Check the console.</span></div>';
	} finally {
		if (confirmBtn) confirmBtn.disabled = false;
	}
}

// ===========================================
// Attach All UI Listeners
// ===========================================
function attachUiListeners() {
	// --- Login ---
	const loginBtn = document.getElementById("loginBtn");
	if (loginBtn) {
		loginBtn.addEventListener("click", () => {
			// include read scopes so user's playlists are visible to the picker
			const scope = "playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative";
			const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
			window.location.href = authUrl;
		});
	}

	// --- Search ---
	const searchBtn = document.getElementById("searchBtn");
	const searchInput = document.getElementById("searchInput");
	if (searchBtn && searchInput) {
		searchBtn.addEventListener("click", () => {
			const artist = searchInput.value.trim();
			if (artist) searchArtist(artist);
		});
		searchInput.addEventListener("keyup", (e) => {
			if (e.key === 'Enter') {
				const artist = searchInput.value.trim();
				if (artist) searchArtist(artist);
			}
		});
	}

	// --- Add Selected ---
	const addSelectedBtn = document.getElementById('addSelectedBtn');
	if (addSelectedBtn) {
		// start disabled until any checkboxes are selected
		addSelectedBtn.disabled = true;

		addSelectedBtn.addEventListener('click', () => {
			const checked = Array.from(document.querySelectorAll('.track-checkbox:checked'));
			if (!checked.length) {
				showToast('No tracks selected', 'info');
				return;
			}
			pendingSelectedUris = checked.map(cb => cb.dataset.uri);
			pendingSelectedNames = checked.map(cb => decodeURIComponent(cb.dataset.name));
			openPlaylistModal(pendingSelectedNames);
		});
	}

	// --- Theme Toggle ---
	const themeBtn = document.getElementById('themeBtn');
	if (themeBtn) {
		themeBtn.addEventListener('click', () => {
			document.body.classList.toggle('theme-light');
		});
	}

	// --- Add-to-top dropdown ---
	const addToTopDropdown = document.getElementById('addToTopDropdown');
	if (addToTopDropdown) {
		addToTopDropdown.value = addToTop ? 'top' : 'bottom';
		addToTopDropdown.addEventListener('change', () => {
			addToTop = addToTopDropdown.value === 'top';
		});
	}

	// --- Create Playlist from sidebar ---
	const createBtn = document.getElementById('createPlaylistFromSelectionBtn');
	if (createBtn) {
		createBtn.addEventListener('click', () => {
			if (!playlistTracks.length) {
				showToast('Add some tracks to your playlist first', 'info');
				return;
			}
			pendingSelectedUris = playlistTracks.map(t => t.uri);
			pendingSelectedNames = playlistTracks.map(t => t.name);
			openPlaylistModal(pendingSelectedNames);
		});
	}

	// --- More Tools Modal ---
	const moreToolsBtn = document.getElementById('moreToolsBtn');
	const toolsCloseBtn = document.getElementById('toolsCloseBtn');
	if (moreToolsBtn) moreToolsBtn.addEventListener('click', () => openModal('toolsModal'));
	if (toolsCloseBtn) toolsCloseBtn.addEventListener('click', () => closeModal('toolsModal'));

	// --- Delete Duplicates ---
	const deleteDuplicatesBtn = document.getElementById('deleteDuplicatesBtn');
	const deleteDuplicatesCancelBtn = document.getElementById('deleteDuplicatesCancelBtn');
	const deleteDuplicatesConfirmBtn = document.getElementById('deleteDuplicatesConfirmBtn');

	if (deleteDuplicatesBtn) {
		deleteDuplicatesBtn.addEventListener('click', () => {
			closeModal('toolsModal');
			openModal('deleteDuplicatesModal');
			// Refresh and load playlists into pickers
			cachedUserPlaylists = null;
			loadPickerPlaylists(
				['dupPlaylistList', 'dupRefList'],
				['dupSelectedPlaylistId', 'dupSelectedRefId']
			);
		});
	}
	if (deleteDuplicatesCancelBtn) {
		deleteDuplicatesCancelBtn.addEventListener('click', () => closeModal('deleteDuplicatesModal'));
	}
	if (deleteDuplicatesConfirmBtn) {
		deleteDuplicatesConfirmBtn.addEventListener('click', handleDeleteDuplicates);
	}

	// --- Copy Playlist ---
	const copyPlaylistBtn = document.getElementById('copyPlaylistBtn');
	const copyPlaylistCancelBtn = document.getElementById('copyPlaylistCancelBtn');
	const copyPlaylistConfirmBtn = document.getElementById('copyPlaylistConfirmBtn');

	if (copyPlaylistBtn) {
		copyPlaylistBtn.addEventListener('click', () => {
			closeModal('toolsModal');
			openModal('copyPlaylistModal');
			// Refresh and load playlists into pickers
			cachedUserPlaylists = null;
			loadPickerPlaylists(
				['copySrcList', 'copyTgtList'],
				['copySelectedSrcId', 'copySelectedTgtId']
			);
		});
	}
	if (copyPlaylistCancelBtn) {
		copyPlaylistCancelBtn.addEventListener('click', () => closeModal('copyPlaylistModal'));
	}
	if (copyPlaylistConfirmBtn) {
		copyPlaylistConfirmBtn.addEventListener('click', handleCopyPlaylist);
	}

	// --- Playlist Modal ---
	const playlistCancelBtn = document.getElementById('playlistCancelBtn');
	const playlistCreateBtn = document.getElementById('playlistCreateBtn');
	const playlistNameInput = document.getElementById('playlistNameInput');

	if (playlistCancelBtn) playlistCancelBtn.addEventListener('click', () => closeModal('playlistModal'));
	if (playlistNameInput) {
		playlistNameInput.addEventListener('keyup', (e) => {
			if (e.key === 'Enter' && playlistCreateBtn) playlistCreateBtn.click();
		});
	}

	if (playlistCreateBtn) {
		playlistCreateBtn.addEventListener('click', async () => {
			// Determine if user selected an existing playlist
			const pickerHidden = document.getElementById('playlistPickerSelectedId');
			const urlInput = document.getElementById('playlistPickerUrlInput');
			const nameInput = document.getElementById('playlistNameInput');
			const chosenPlaylistId = (pickerHidden && pickerHidden.value) || (urlInput ? urlInput.value.trim() : '');

			closeModal('playlistModal');
			playlistCreateBtn.disabled = true;

			try {
				const resultsEl = document.getElementById('results');
				if (chosenPlaylistId) {
					// Add to existing playlist
					if (resultsEl) resultsEl.innerHTML = '<div class="loading-state"><div class="spinner spinner-lg"></div><span>Adding tracks to existing playlist…</span></div>';

					if (addToTop) {
						for (let i = pendingSelectedUris.length - 1; i >= 0; --i) {
							await addTracksToPlaylist(chosenPlaylistId, [pendingSelectedUris[i]]);
						}
					} else {
						for (let i = 0; i < pendingSelectedUris.length; i += 100) {
							const chunk = pendingSelectedUris.slice(i, i + 100);
							await addTracksToPlaylist(chosenPlaylistId, chunk);
						}
					}

					showToast('Tracks added to playlist!', 'success');
					if (resultsEl) resultsEl.innerHTML = `<div class="loading-state"><span>✅ Added ${pendingSelectedUris.length} track(s) to the selected playlist.</span></div>`;
				} else {
					// Create new playlist
					const name = nameInput ? nameInput.value.trim() : '';
					if (!name) {
						showToast('Please enter a playlist name', 'error');
						return;
					}
					if (resultsEl) resultsEl.innerHTML = '<div class="loading-state"><div class="spinner spinner-lg"></div><span>Creating playlist…</span></div>';

					const playlist = await createPlaylist(name, true);
					if (!playlist || !playlist.id) throw new Error('Failed to create playlist');

					// Add tracks: one-by-one in reverse if addToTop, else batch
					if (addToTop) {
						for (let i = pendingSelectedUris.length - 1; i >= 0; --i) {
							await addTracksToPlaylist(playlist.id, [pendingSelectedUris[i]]);
						}
					} else {
						for (let i = 0; i < pendingSelectedUris.length; i += 100) {
							const chunk = pendingSelectedUris.slice(i, i + 100);
							await addTracksToPlaylist(playlist.id, chunk);
						}
					}

					showToast(`Playlist "${playlist.name}" created!`, 'success');
					if (resultsEl) resultsEl.innerHTML = `<div class="loading-state"><span>✅ Playlist created: <a href="${playlist.external_urls.spotify}" target="_blank" style="color:var(--accent)">${playlist.name}</a></span></div>`;

					// invalidate cached playlists so pickers refresh
					cachedUserPlaylists = null;
				}

				// Add to sidebar playlist view (local)
				pendingSelectedNames.forEach((n, idx) => addToPlaylist(pendingSelectedUris[idx], n));
				pendingSelectedUris = [];
				pendingSelectedNames = [];

				// Uncheck checkboxes and disable Add Selected
				document.querySelectorAll('.track-checkbox:checked').forEach(cb => cb.checked = false);
				const addSel = document.getElementById('addSelectedBtn');
				if (addSel) addSel.disabled = true;
			} catch (err) {
				console.error(err);
				showToast('Failed to create/add playlist: ' + (err.message || 'unknown'), 'error');
			} finally {
				playlistCreateBtn.disabled = false;
			}
		});
	}

	// --- Close modals on overlay click ---
	document.querySelectorAll('.modal-overlay').forEach(overlay => {
		overlay.addEventListener('click', () => {
			const modal = overlay.closest('.modal');
			if (modal) {
				modal.classList.remove('open');
				modal.setAttribute('aria-hidden', 'true');
			}
		});
	});

	// --- Close modals on Escape ---
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			document.querySelectorAll('.modal.open').forEach(modal => {
				modal.classList.remove('open');
				modal.setAttribute('aria-hidden', 'true');
			});
		}
	});
}

// ===========================================
// Init
// ===========================================
document.addEventListener("DOMContentLoaded", async () => {
	attachUiListeners();
	updatePlaylistUI();
	initPickerTabs();

	// If we have a token already, show user info
	if (accessToken) {
		fetchAndDisplayUser();
	}

	// If redirected with auth code, exchange it
	if (authCode && !accessToken) {
		console.log("AUTH CODE:", authCode);
		await exchangeCodeForToken(authCode);
	}
});
