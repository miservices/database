// api/lookup.js
//
// Vercel serverless function. Runs server-side only — this is where the
// Roblox Open Cloud API key lives, in an environment variable, never in
// front-end code.
//
// Called as: GET /api/lookup?username=SomeRobloxUser
//
// Required environment variables (set in Vercel project settings):
//   ROBLOX_API_KEY        - Open Cloud API key, scope: datastores.objects:read
//   ROBLOX_UNIVERSE_ID    - your game's Universe ID (not Place ID)
//   ROBLOX_DATASTORE_NAME - optional, defaults to "CriminalRecords_v1"
//                            (must match RECORDS_STORE_NAME in BookingHandler.server.lua)

// Very small in-memory cache to cut down on repeat Open Cloud calls for the
// same username within a warm serverless instance. Not persistent/shared
// across instances — just a cheap first line of defense against someone
// spamming the same search.
const cache = new Map();
const CACHE_TTL_MS = 30 * 1000;

// Allowed origins for cross-origin requests. Add any domain that will embed
// or call this API from the browser (your GitHub Pages site, custom domain,
// local testing, etc).
const ALLOWED_ORIGINS = [
  'https://migovt.org',
  'https://www.migovt.org',
];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const username = (req.query.username || '').toString().trim();

  if (!username) {
    return res.status(400).json({ error: 'missing_username', message: 'Provide ?username=' });
  }
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'invalid_username', message: 'That doesn\'t look like a valid Roblox username.' });
  }

  const cacheKey = username.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return res.status(200).json(cached.data);
  }

  try {
    // 1. Resolve username -> userId via Roblox's public Users API
    const userRes = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });

    if (!userRes.ok) {
      return res.status(502).json({ error: 'roblox_users_error', message: 'Could not reach Roblox to resolve that username.' });
    }

    const userData = await userRes.json();
    if (!userData.data || userData.data.length === 0) {
      return res.status(404).json({ error: 'not_found', message: `No Roblox user named "${username}" was found.` });
    }

    const { id: userId, name: resolvedUsername, displayName } = userData.data[0];

    // 2. Best-effort avatar headshot (doesn't block the lookup if it fails)
    let avatarUrl = null;
    try {
      const avatarRes = await fetch(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`
      );
      if (avatarRes.ok) {
        const avatarData = await avatarRes.json();
        avatarUrl = avatarData?.data?.[0]?.imageUrl || null;
      }
    } catch (_e) {
      // ignore — avatar is cosmetic
    }

    // 3. Pull the criminal record from the game's DataStore via Open Cloud
    const universeId = process.env.ROBLOX_UNIVERSE_ID;
    const apiKey = process.env.ROBLOX_API_KEY;
    const datastoreName = process.env.ROBLOX_DATASTORE_NAME || 'CriminalRecords_v1';

    if (!universeId || !apiKey) {
      return res.status(500).json({
        error: 'server_misconfigured',
        message: 'ROBLOX_API_KEY / ROBLOX_UNIVERSE_ID are not set on the server.',
      });
    }

    const entryKey = `Player_${userId}`;
    const dsUrl =
      `https://apis.roblox.com/datastores/v1/universes/${universeId}/standard-datastores/datastore/entries/entry` +
      `?datastoreName=${encodeURIComponent(datastoreName)}&entryKey=${encodeURIComponent(entryKey)}`;

    const dsRes = await fetch(dsUrl, { headers: { 'x-api-key': apiKey } });

    let payload;

    if (dsRes.status === 404) {
      // No record on file — a clean citizen.
      payload = {
        userId,
        username: resolvedUsername,
        displayName,
        avatarUrl,
        clean: true,
        totalArrests: 0,
        arrests: [],
      };
    } else if (!dsRes.ok) {
      const text = await dsRes.text();
      console.error('Open Cloud DataStore error', dsRes.status, text);
      return res.status(502).json({ error: 'datastore_error', message: 'Could not reach the game database.' });
    } else {
      const record = await dsRes.json();
      const arrests = Array.isArray(record.arrests) ? record.arrests : [];

      payload = {
        userId,
        username: record.username || resolvedUsername,
        name: record.name || displayName, // in-universe roleplay name
        avatarUrl,
        clean: arrests.length === 0,
        totalArrests: arrests.length,
        // newest first
        arrests: arrests.slice().reverse(),
      };
    }

    cache.set(cacheKey, { time: Date.now(), data: payload });
    return res.status(200).json(payload);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong on our end.' });
  }
}
