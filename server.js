const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

console.log("REDIRECT_URI:", process.env.REDIRECT_URI);

app.post('/auth/exchange', async (req, res) => {
	const { code } = req.body;
	if (!code) return res.status(s400).json({ error: 'missing_code' });

	const params = new URLSearchParams();
	params.append('grant_type', 'authorization_code');
	params.append('code', code);
	params.append('redirect_uri', process.env.REDIRECT_URI);

	const basic = Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64');

	try {
		const resp = await fetch('https://accounts.spotify.com/api/token', {
			method: 'POST',
			headers: {
				Authorization: `Basic ${basic}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: params
		});
		const data = await resp.json();
		return res.json(data);
	} catch (err) {
		console.error(err);
		return res.status(500).json({ error: 'server_error' });
	}
});

app.post('/auth/refresh', async (req, res) => {
	const { refresh_token } = req.body;
	if (!refresh_token) return res.status(400).json({ error: 'missing_refresh_token' });

	const params = new URLSearchParams();
	params.append('grant_type', 'refresh_token');
	params.append('refresh_token', refresh_token);

	const basic = Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64');

	try {
		const resp = await fetch('https://accounts.spotify.com/api/token', {
			method: 'POST',
			headers: {
				Authorization: `Basic ${basic}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: params
		});
		const data = await resp.json();
		return res.json(data);
	} catch (err) {
		console.error(err);
		return res.status(500).json({ error: 'server_error' });
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auth server listening on ${PORT}`));