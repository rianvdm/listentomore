# Apple MusicKit API Setup Guide

This guide explains how to set up Apple MusicKit API access to get Apple Music links from Spotify IDs.

## Why MusicKit API?

The iTunes Search API (`itunes.apple.com/search`) blocks requests from cloud providers (Cloudflare Workers, AWS Lambda, etc.) with 403 Forbidden errors. The official Apple Music API (MusicKit) works from server-side environments and offers:

- **ISRC/UPC lookup**: More reliable matching than text search
- **20 requests/second** rate limit (vs iTunes API's aggressive blocking)
- **Server-side compatible**: Works from Cloudflare Workers

## Prerequisites

- Apple Developer Account ($99/year)

## Setup Steps

### 1. Create an Apple Developer Account

1. Go to [developer.apple.com](https://developer.apple.com)
2. Sign in with your Apple ID or create one
3. Enroll in the Apple Developer Program ($99/year)
4. Wait for enrollment approval (usually instant for individuals)

### 2. Create a MusicKit Identifier

1. Go to [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)
2. Click the **+** button to create a new identifier
3. Select **Media IDs** → Continue
4. Select **MusicKit** → Continue
5. Enter a description (e.g., "ListenToMore MusicKit")
6. Enter an identifier (e.g., `com.listentomore.musickit`)
7. Click **Continue** → **Register**

### 3. Create a MusicKit Private Key

1. Go to [Keys](https://developer.apple.com/account/resources/authkeys/list)
2. Click the **+** button to create a new key
3. Enter a key name (e.g., "ListenToMore MusicKit Key")
4. Check **MusicKit** checkbox
5. Click **Configure** next to MusicKit
6. Select your MusicKit identifier from step 2
7. Click **Save** → **Continue** → **Register**
8. **IMPORTANT**: Download the private key (.p8 file) immediately - you can only download it once!
9. Note the **Key ID** displayed on the page

### 4. Get Your Team ID

1. Go to [Membership](https://developer.apple.com/account/#!/membership)
2. Find your **Team ID** (a 10-character alphanumeric string)

### 5. Store Your Credentials Securely

You'll need these three pieces of information:
- **Team ID**: From step 4
- **Key ID**: From step 3
- **Private Key**: Contents of the .p8 file from step 3

For Cloudflare Workers, store these as secrets:

```bash
# Set secrets (run from apps/web directory)
echo "YOUR_TEAM_ID" | npx wrangler secret put APPLE_TEAM_ID
echo "YOUR_KEY_ID" | npx wrangler secret put APPLE_KEY_ID

# For the private key, paste the entire contents including BEGIN/END lines
npx wrangler secret put APPLE_PRIVATE_KEY
```

For local development, add to `.dev.vars`:
```
APPLE_TEAM_ID=your_team_id
APPLE_KEY_ID=your_key_id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...key contents...
-----END PRIVATE KEY-----"
```

## API Usage

### JWT Token Generation

The Apple Music API requires a signed JWT token. The token:
- Uses ES256 (ECDSA with P-256 and SHA-256)
- Expires in up to 6 months (we'll use shorter for security)
- Contains your Team ID as `iss` (issuer)

```typescript
import { SignJWT, importPKCS8 } from 'jose';

async function generateAppleMusicToken(
  teamId: string,
  keyId: string,
  privateKey: string
): Promise<string> {
  const key = await importPKCS8(privateKey, 'ES256');
  
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .setExpirationTime('1h') // Short-lived for security
    .sign(key);
  
  return token;
}
```

### API Endpoints

Base URL: `https://api.music.apple.com/v1`

#### Search by ISRC (Recommended for Tracks)

```
GET /v1/catalog/{storefront}/songs?filter[isrc]={isrc}
```

Example:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.music.apple.com/v1/catalog/us/songs?filter[isrc]=USRC11600119"
```

#### Search by UPC (Recommended for Albums)

```
GET /v1/catalog/{storefront}/albums?filter[upc]={upc}
```

Example:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.music.apple.com/v1/catalog/us/albums?filter[upc]=00602547261496"
```

#### Text Search (Fallback)

```
GET /v1/catalog/{storefront}/search?term={query}&types=songs,albums
```

### Storefronts

The `{storefront}` parameter is a two-letter country code (ISO 3166-1 alpha-2):
- `us` - United States
- `gb` - United Kingdom
- `de` - Germany
- etc.

Use `us` as default - it has the largest catalog.

## ISRC and UPC Availability

### ISRC (International Standard Recording Code)
- Available for most tracks released after ~1980s
- Spotify provides ISRC via `external_ids.isrc` on track objects
- Format: 12 characters (e.g., `USRC11600119`)

### UPC (Universal Product Code)
- Available for most albums, including older releases
- Standard product identifier since the 1970s
- Spotify provides UPC via `external_ids.upc` on album objects
- Format: 12-14 digits (e.g., `00602547261496`)
- Some very obscure or independent releases may not have a UPC

### Availability Notes
- **Modern releases**: Nearly always have both ISRC and UPC
- **Classic albums**: Usually have UPC (assigned for CD/vinyl releases)
- **Digital-only releases**: Usually have ISRC, may lack UPC
- **Compilations**: Tracks have their original ISRCs

## Rate Limits

- **20 requests per second** per developer token
- If exceeded, you'll get a 429 Too Many Requests response
- Implement exponential backoff and caching

## Response Format

Songs response example:
```json
{
  "data": [{
    "id": "1440818231",
    "type": "songs",
    "href": "/v1/catalog/us/songs/1440818231",
    "attributes": {
      "albumName": "Lemonade",
      "artistName": "Beyoncé",
      "name": "Formation",
      "url": "https://music.apple.com/us/album/formation/1440817813?i=1440818231",
      "isrc": "USRC11600119",
      "durationInMillis": 224773
    }
  }]
}
```

Albums response example:
```json
{
  "data": [{
    "id": "1440817813",
    "type": "albums",
    "href": "/v1/catalog/us/albums/1440817813",
    "attributes": {
      "artistName": "Beyoncé",
      "name": "Lemonade",
      "url": "https://music.apple.com/us/album/lemonade/1440817813",
      "upc": "886445635461",
      "trackCount": 12,
      "releaseDate": "2016-04-23"
    }
  }]
}
```

## Implementation Checklist

- [ ] Create Apple Developer account
- [ ] Create MusicKit identifier
- [ ] Generate and download private key
- [ ] Store credentials as Cloudflare Worker secrets
- [ ] Ensure Spotify service returns ISRC (tracks) and UPC (albums)
- [ ] Implement JWT token generation with caching
- [ ] Implement Apple Music provider using ISRC/UPC lookup
- [ ] Add text search fallback for items without identifiers
- [ ] Add caching for Apple Music results

## Troubleshooting

### 401 Unauthorized
- Check your JWT token is correctly signed
- Verify Team ID and Key ID are correct
- Ensure the private key matches the Key ID

### 403 Forbidden
- Your MusicKit capability may not be properly configured
- Check the MusicKit identifier is linked to your key

### No Results
- Try a different storefront (some content is region-specific)
- The ISRC/UPC may not exist in Apple Music's catalog
- Fall back to text search

## Resources

- [Apple Music API Documentation](https://developer.apple.com/documentation/applemusicapi)
- [Get Songs by ISRC](https://developer.apple.com/documentation/applemusicapi/get-multiple-catalog-songs-by-isrc)
- [Search Catalog](https://developer.apple.com/documentation/applemusicapi/search-for-catalog-resources-(by-type))
