// Test fixtures - Sample API responses for testing

// Spotify API fixtures
export const spotifyFixtures = {
  album: {
    id: '4LH4d3cOWNNsVw41Gqt2kv',
    name: 'In Rainbows',
    artists: [{ name: 'Radiohead', id: '4Z8W4fKeB5YxbusRsdQVPb' }],
    release_date: '2007-10-10',
    total_tracks: 10,
    genres: ['alternative rock', 'art rock'],
    external_urls: { spotify: 'https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv' },
    images: [{ url: 'https://i.scdn.co/image/ab67616d0000b273abc123' }],
    label: 'XL Recordings',
    popularity: 82,
    copyrights: [{ text: '2007 XL Recordings Ltd' }],
    tracks: {
      items: [
        {
          track_number: 1,
          name: '15 Step',
          duration_ms: 237000,
          preview_url: null,
          artists: [{ name: 'Radiohead' }],
        },
        {
          track_number: 2,
          name: 'Bodysnatchers',
          duration_ms: 242000,
          preview_url: null,
          artists: [{ name: 'Radiohead' }],
        },
      ],
    },
  },

  artist: {
    id: '4Z8W4fKeB5YxbusRsdQVPb',
    name: 'Radiohead',
    genres: ['alternative rock', 'art rock', 'permanent wave'],
    external_urls: { spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb' },
    images: [{ url: 'https://i.scdn.co/image/ab67616d0000b273artist123' }],
    followers: { total: 8500000 },
    popularity: 82,
  },

  artistAlbums: {
    items: [
      {
        id: '4LH4d3cOWNNsVw41Gqt2kv',
        name: 'In Rainbows',
        album_type: 'album',
        release_date: '2007-10-10',
        images: [{ url: 'https://i.scdn.co/image/ab67616d0000b273abc123' }],
      },
      {
        id: '6dVIqQ8qmQ5GBnJ9shOYGE',
        name: 'OK Computer',
        album_type: 'album',
        release_date: '1997-05-21',
        images: [{ url: 'https://i.scdn.co/image/ab67616d0000b273def456' }],
      },
    ],
  },

  relatedArtists: {
    artists: [
      {
        id: '3AA28KZvwAUcZuOKwyblJQ',
        name: 'Gorillaz',
        genres: ['alternative rock', 'modern rock'],
        images: [{ url: 'https://i.scdn.co/image/gorillaz.jpg' }],
        followers: { total: 12000000 },
        popularity: 80,
        external_urls: { spotify: 'https://open.spotify.com/artist/3AA28KZvwAUcZuOKwyblJQ' },
      },
    ],
  },

  searchAlbums: {
    albums: {
      items: [
        {
          id: '4LH4d3cOWNNsVw41Gqt2kv',
          name: 'In Rainbows',
          artists: [{ name: 'Radiohead', id: '4Z8W4fKeB5YxbusRsdQVPb' }],
          album_type: 'album',
          release_date: '2007-10-10',
          total_tracks: 10,
          images: [{ url: 'https://i.scdn.co/image/ab67616d0000b273abc123' }],
          external_urls: { spotify: 'https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv' },
        },
      ],
    },
  },
};

// Last.fm API fixtures
export const lastfmFixtures = {
  recentTracks: {
    recenttracks: {
      track: [
        {
          name: 'Reckoner',
          artist: { '#text': 'Radiohead' },
          album: { '#text': 'In Rainbows' },
          image: [{ '#text': '', size: 'small' }, { '#text': '', size: 'medium' }, { '#text': 'https://lastfm.freetls.fastly.net/i/u/174s/album.png', size: 'large' }],
          date: { uts: '1700000000', '#text': '14 Nov 2023, 12:00' },
          '@attr': undefined,
        },
        {
          name: 'Weird Fishes/Arpeggi',
          artist: { '#text': 'Radiohead' },
          album: { '#text': 'In Rainbows' },
          image: [{ '#text': '', size: 'small' }, { '#text': '', size: 'medium' }, { '#text': 'https://lastfm.freetls.fastly.net/i/u/174s/album.png', size: 'large' }],
          date: { uts: '1699999700', '#text': '14 Nov 2023, 11:55' },
        },
      ],
      '@attr': { user: 'testuser', page: '1', perPage: '10', totalPages: '100', total: '1000' },
    },
  },

  topAlbums: {
    topalbums: {
      album: [
        {
          name: 'In Rainbows',
          artist: { name: 'Radiohead' },
          image: [{ '#text': '', size: 'small' }, { '#text': '', size: 'medium' }, { '#text': 'https://lastfm.freetls.fastly.net/i/u/174s/album.png', size: 'large' }],
          playcount: '150',
          '@attr': { rank: '1' },
        },
      ],
      '@attr': { user: 'testuser', page: '1', perPage: '10', totalPages: '10', total: '100' },
    },
  },

  topArtists: {
    topartists: {
      artist: [
        {
          name: 'Radiohead',
          playcount: '500',
          image: [{ '#text': '', size: 'small' }, { '#text': '', size: 'medium' }, { '#text': 'https://lastfm.freetls.fastly.net/i/u/174s/artist.png', size: 'large' }],
          '@attr': { rank: '1' },
        },
      ],
      '@attr': { user: 'testuser', page: '1', perPage: '10', totalPages: '10', total: '100' },
    },
  },

  lovedTracks: {
    lovedtracks: {
      track: [
        {
          name: 'Reckoner',
          artist: { name: 'Radiohead' },
          image: [{ '#text': '', size: 'small' }, { '#text': '', size: 'medium' }, { '#text': 'https://lastfm.freetls.fastly.net/i/u/174s/album.png', size: 'large' }],
          date: { uts: '1700000000', '#text': '14 Nov 2023, 12:00' },
        },
      ],
      '@attr': { user: 'testuser', page: '1', perPage: '10', totalPages: '1', total: '1' },
    },
  },
};

// Songlink API fixtures
export const songlinkFixtures = {
  response: {
    entityUniqueId: 'SPOTIFY_SONG::6rqhFgbbKwnb9MLmUQDhG6',
    userCountry: 'US',
    pageUrl: 'https://song.link/s/6rqhFgbbKwnb9MLmUQDhG6',
    linksByPlatform: {
      spotify: { url: 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6' },
      appleMusic: { url: 'https://music.apple.com/us/album/reckoner/1109714933?i=1109715066' },
      youtube: { url: 'https://www.youtube.com/watch?v=rOoCixFA8OI' },
      youtubeMusic: { url: 'https://music.youtube.com/watch?v=rOoCixFA8OI' },
      tidal: { url: 'https://tidal.com/browse/track/3118290' },
      deezer: { url: 'https://www.deezer.com/track/3129637' },
      amazonMusic: { url: 'https://music.amazon.com/albums/B01LXGG7LO?trackAsin=B01LXN3I5V' },
    },
    entitiesByUniqueId: {},
  },
};

// AI API fixtures
export const aiFixtures = {
  artistSummary: {
    choices: [
      {
        message: {
          content: 'Radiohead is a groundbreaking English rock band formed in 1985. Known for their experimental approach to rock music, they have consistently pushed boundaries with albums like "OK Computer" and "Kid A".',
        },
      },
    ],
  },

  genreSummary: {
    choices: [
      {
        message: {
          content: 'Alternative rock emerged in the 1980s as an umbrella term for underground music that challenged mainstream rock conventions.',
        },
      },
    ],
    citations: ['https://en.wikipedia.org/wiki/Alternative_rock'],
  },
};
