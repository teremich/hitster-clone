import type { NextFunction, Request, Response as Res } from "express";
import express from "express";
// @ts-ignore
import type { Response, UsersSavedTracksResponse, PlaylistTrackResponse, SpotifyWebApi } from "spotify-web-api-node"
import SpotifyApi from "spotify-web-api-node";
import * as ejs from "ejs";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "dotenv";
config();

const app = express();
const port = process.env.SPOTIFY_PORT ?? "3050";
const key = randomBytes(32);
const iv = randomBytes(16);

const client_id: string = process.env.SPOTIFY_CLIENT_ID!;
const client_secret: string = process.env.SPOTIFY_CLIENT_SECRET!;

const scopes = [
    'ugc-image-upload',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'streaming',
    'app-remote-control',
    'user-read-email',
    'user-read-private',
    'playlist-read-collaborative',
    'playlist-modify-public',
    'playlist-read-private',
    'playlist-modify-private',
    'user-library-modify',
    'user-library-read',
    'user-top-read',
    'user-read-playback-position',
    'user-read-recently-played',
    'user-follow-read',
    'user-follow-modify'
];

const spotifyApi: SpotifyWebApi =
// @ts-ignore
new SpotifyApi({
    clientId: client_id,
    clientSecret: client_secret,
    redirectUri: `http://hitster.localhost:${port}/callback`
});

interface playlist_t {
    uri: string;
    name: string;
    ft: boolean;
    image?: string;
    id: string;
};

interface track_t {
    name: string;
    uri: string;
    duration_ms: number;
    year?: string;
}

async function debugMiddleware(req: Request, res: Res, next: NextFunction) {
    console.log(req.url);
    next();
}

function randomize<T>(array: T[]): T[] {
    let copy = Array.from(array);
    var j: number, x: T, i: number;
    for (i = copy.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        x = copy[i];
        copy[i] = copy[j];
        copy[j] = x;
    }
    return copy;
}

app.get('/login', debugMiddleware, (req: any, res: any) => {
    res.redirect(spotifyApi.createAuthorizeURL(scopes, randomUUID()));
});

async function getAllTracks(playlist: string): Promise<track_t[]> {
    let res: Response<UsersSavedTracksResponse> | Response<PlaylistTrackResponse>;
    let tracks: track_t[] = [];
    do {
        if (playlist == "ft") {
            res = await spotifyApi.getMySavedTracks({
                limit: 50,
                offset: tracks.length
            });
        } else {
            res = await spotifyApi.getPlaylistTracks(playlist, {
                limit: 50,
                offset: tracks.length
            });
        }
        for (let item of res.body.items) {
            tracks.push({
                name: item.track!.name,
                uri: item.track!.uri,
                duration_ms: item.track!.duration_ms,
                year: item.track!.album?.release_date?.slice(0, 7)
            });
        }
    } while (tracks.length < res.body.total);
    console.log(`[INFO] there were ${tracks.length} tracks in the response`);
    return tracks;
}

async function placeRandomInQueue(tracks: track_t[]) {
    tracks = randomize(tracks);
    let uris: string[] = [];
    for (let track of tracks) {
        uris.push(track.uri);
    }
    let res = await spotifyApi.getMyDevices();
    let devices: any[] = [];
    for (let d of res.body.devices) {
        devices.push({
            id: d.id,
            type: d.type,
            name: d.name
        });
    }
    await spotifyApi.play({
        uris: uris.slice(0, 50),
        device_id: devices[0].id
    }).catch((e: any) => {
        console.log("[ERROR:placeRandomInQueue:play]", e);
    });
    for (let i = 50; i < uris.length && i < 400; i++) {
        await spotifyApi.addToQueue(uris[i], {
            device_id: devices[0].id
        });
    }
}

app.get('/callback', debugMiddleware, async (req: Request, res: Res) => {
    const error = req.query.error;
    const code = req.query.code;

    if (error) {
        console.error('Callback Error:', error);
        res.send(`Callback Error: ${error}`);
        return;
    }

    await spotifyApi
        .authorizationCodeGrant(code?.toString() ?? "")
        .then((data: any) => {
            const access_token = data.body['access_token'];
            const refresh_token = data.body['refresh_token'];
            let expires_in = data.body['expires_in'];

            spotifyApi.setAccessToken(access_token);
            spotifyApi.setRefreshToken(refresh_token);

            console.log('[INFO] access_token:', access_token);
            console.log('[INFO] refresh_token:', refresh_token);

            console.log(
                `[INFO] Sucessfully retreived access token. Expires in ${expires_in}s.`
            );
        })
        .catch((error: string) => {
            console.error('Error getting Tokens:', error);
            res.send(`Error getting Tokens: ${error}`);
        });
    ejs.renderFile("public/play/index.ejs", {year: ""}, {}, (error, string) => {
        if (error) { console.log("[ERROR:callback:renderFile]", error); }
        res.send(string);
    });
});

async function playFromRandom(track: track_t) {
    let res = await spotifyApi.getMyDevices();
    let devices: any[] = [];
    for (let d of res.body.devices) {
        devices.push({
            id: d.id,
            type: d.type,
            name: d.name
        });
    }
    await spotifyApi.play({
        uris: [track.uri],
        device_id: devices[0].id,
        position_ms: (track.duration_ms ?? 0)*(Math.random()*0.8 + 0.1)
    }).catch((e: any) => {
        console.log("[ERROR:playFromRandom:play]", e);
    });
}

function stopPlayback() {
    spotifyApi.pause();
}

let timer: NodeJS.Timeout | null = null;
app.get("/next", debugMiddleware, async (req: Request, res) => {
    if (timer != null) {
        clearTimeout(timer);
    }
    let playlists: playlist_t[] = [
        {
            ft: false, name: "Playlist", id: "4VxdlVzE0TLYqNMfwY8VkC", uri: "spotify:playlist:4VxdlVzE0TLYqNMfwY8VkC"
        }
    ];
    let randomIndex = Math.floor(Math.random()*playlists.length);
    let tracks: track_t[] = await getAllTracks(
        playlists[randomIndex].uri.split(":")[2]
    );
    randomIndex = Math.floor(Math.random()*tracks.length);
    playFromRandom(tracks[randomIndex]);
    ejs.renderFile("public/play/index.ejs", {year: tracks[randomIndex].year ?? ""}, {}, (error, string) => {
        if (error) { console.log("[ERROR:callback:renderFile]", error); }
        res.send(string);
    });
    timer = setTimeout(() => {
        stopPlayback();
        timer = null;
    }, 5000);
});

app.listen(port, () => {
    console.log(`listening on ${port}\nhttp://hitster.localhost:${port}/login`);
});

app.use(express.static("public"));
app.use(express.json({ limit: "1mb" }));
