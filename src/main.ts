import { JSDOM } from "jsdom";
import fetch from "node-fetch";
import sqlite3 from 'sqlite3';
import { Database, open } from 'sqlite';

interface Song {
  title: string,
  artist: string,
  playedAt: number,
}

let db: Database;

const initDatabase = async () => {
  db = await open({
    filename: process.argv[2] || 'data.db',
    driver: sqlite3.Database
  });

  db.exec(`CREATE TABLE IF NOT EXISTS plays(
    id INTEGER PRIMARY KEY ASC,
    song INTEGER NOT NULL REFERENCES songs(id),
    playedAt INTEGER NOT NULL);`);
  
  db.exec(`CREATE TABLE IF NOT EXISTS songs(
      id INTEGER PRIMARY KEY ASC,
      title TEXT NOT NULL,
      artist TEXT NOT NULL);`);
}

const fetchSongs = async () => {
  const res = await fetch("https://www.air1.com/music/songs");

  const { window } = new JSDOM(await res.text());
  
  const songs: Song[] = [];
  
  window.document.querySelectorAll(".card-body").forEach((v) => {
    const timeStr = v.querySelectorAll("p")[0]?.textContent?.toLowerCase?.()?.trim();
    if (!timeStr) {
      console.error("DIDN'T FIND TIMESTR");
      return;
    }

    let minutesAgo = 0;
  
    if (timeStr == "last played") {
      minutesAgo = 0;
    } else {
      minutesAgo = parseInt(timeStr.split(' ')[0], 10);
    }
  
    songs.push({
      title: v.querySelector("h5")?.textContent || "",
      artist: v.querySelectorAll("p")?.[1]?.textContent?.slice(2) || "",
      playedAt: +new Date() - minutesAgo * 60 * 1000,
    });
  });

  return songs;
}

const insertSongs = async (songs: Song[]) => {
  const normalizedSongs = songs.map(({
    title,
    artist,
    playedAt,
  }) => ({
    title: title.toLowerCase().trim(),
    artist: artist.toLowerCase().trim(),
    playedAt,
  }))

  const dbSongsPromises = normalizedSongs.map(async ({
    title,
    artist,
    playedAt,
  }) => {
    const res = await db.get('SELECT * FROM songs WHERE title = ? AND artist = ?;', title, artist);
    let id = null;
    if (res) {
      id = res.id;
    } else {
      const insertRes = await db.run('INSERT INTO songs (title, artist) VALUES (?, ?);', title, artist);
      id = insertRes.lastID;
      if (!id) {
        console.error("INSERT STATEMENT FAILED");
        return;
      }
    }

    // Check if exists
    const existsRes = db.get(
      'SELECT * FROM plays WHERE song = ? AND playedAt > ? AND playedAt < ?;',
      id,
      playedAt - 1000 * 60 * 5,
      playedAt + 1000 * 60 * 5
    );

    if (!existsRes) {
      return {id, playedAt};
    } else {
      return;
    }

  })

  const songsToInsert = (await Promise.all(dbSongsPromises)).filter((v): v is {id: number, playedAt: number} => !!v);

  songsToInsert.forEach(async ({id, playedAt}) => {
    const insertRes = await db.run('INSERT INTO plays (song, playedAt) VALUES (?, ?);', id, playedAt);
    if (!insertRes.lastID) {
      console.error("SECOND INSERT STATEMENT FAILED");
    }
  })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

(async () => {
  await initDatabase();

  while (true) {
    try {
      const songs = await fetchSongs();
      await insertSongs(songs);
    } catch (e) {
      console.error("There was an error ", e);
    }

    await sleep(1000 * 60 * 15);
  }
})();
