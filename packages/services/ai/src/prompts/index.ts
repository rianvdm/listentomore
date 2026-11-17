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

export {
  generateRandomFact,
  generateAndStoreFact,
  getRandomCachedFact,
  type RandomFactResult,
} from './random-fact';

export { generateListenAIResponse, type ListenAIResult } from './listen-ai';

export {
  generateAlbumRecommendations,
  type AlbumRecommendationsResult,
} from './album-recommendations';

export {
  generateUserInsightsNote,
  buildUserInsightsNoteMessages,
  parseWeekNote,
  USER_INSIGHTS_PROMPT_VERSION,
  USER_INSIGHTS_VOICE_EXAMPLES,
  type UserInsightsNoteResult,
  type WeekNote,
} from './user-insights-note';

export {
  generateUserInsightsRecommendations,
  type UserInsightsRecommendationsResult,
  type AlbumRecommendation,
  type ListeningData as InsightsListeningData,
} from './user-insights-recommendations';
