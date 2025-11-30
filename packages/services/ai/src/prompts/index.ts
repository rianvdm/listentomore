// AI prompts - centralized exports

export {
  generateArtistSummary,
  type ArtistSummaryResult,
} from './artist-summary';

export { generateAlbumDetail, type AlbumDetailResult } from './album-detail';

export { generateGenreSummary, type GenreSummaryResult } from './genre-summary';

export {
  generateArtistSentence,
  type ArtistSentenceResult,
} from './artist-sentence';

export { generateRandomFact, type RandomFactResult } from './random-fact';

export {
  generatePlaylistCoverPrompt,
  generatePlaylistCoverImage,
  type PlaylistCoverPromptResult,
  type PlaylistCoverImageResult,
} from './playlist-cover';

export { generateListenAIResponse, type ListenAIResult } from './listen-ai';
