// Global CSS styles for Listen To More
// Embedded as a string for Cloudflare Workers SSR

export const globalStyles = `
/* Root Variables and Theme Settings */
:root {
  --c-bg: #fafafa;
  --c-bg-rgb: 250, 250, 250;
  --c-accent: #ff6c00;
  --c-accent-rgb: 255, 108, 0;
  --c-base: #000000;
  --c-base-rgb: 0, 0, 0;
}

[data-theme='dark'] {
  --c-bg: #121212;
  --c-bg-rgb: 18, 18, 18;
  --c-accent: #ffa500;
  --c-accent-rgb: 255, 165, 0;
  --c-base: #ffffff;
  --c-base-rgb: 255, 255, 255;
}

/* Reset and Base Styles */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-family: Optima, Candara, 'Noto Sans', source-sans-pro, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  background-color: var(--c-bg);
  color: var(--c-base);
  min-height: 100vh;
  transition: background-color 0.3s, color 0.3s;
}

/* Typography */
p, .footnote {
  color: var(--c-base);
  margin: 1em auto;
  line-height: 1.4em;
  max-width: 800px;
}

p {
  font-size: 18px;
}

.footnote {
  font-size: 12px;
}

/* Links */
a {
  color: var(--c-accent);
  text-decoration: none;
  transition: opacity 0.2s;
}

a:hover {
  opacity: 0.8;
}

/* Headings */
h1 {
  color: var(--c-accent);
  text-align: center;
  margin: 0.4em 0 0.8em;
  font-size: 2rem;
}

h2, h3, h4 {
  color: var(--c-base);
}

h2 {
  text-align: center;
  margin: 2.2em 0 1em;
  font-size: 1.5rem;
}

h3, h4 {
  text-align: left;
  margin: 2em auto 0.5em;
  max-width: 800px;
}

h4 {
  font-size: 18px;
}

/* Main Content Container */
.main-content {
  padding: 1rem;
  max-width: 900px;
  margin: 0 auto;
}

/* Navigation */
.nav {
  background-color: var(--c-bg);
  border-bottom: 1px solid rgba(var(--c-base-rgb), 0.1);
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 60px;
}

.nav-links {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.nav-link {
  color: var(--c-accent);
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  font-size: 15px;
  transition: background-color 0.2s;
}

.nav-link:hover {
  background-color: rgba(var(--c-accent-rgb), 0.1);
  opacity: 1;
}

.nav-link.active {
  font-weight: bold;
}

.nav-brand {
  font-weight: bold;
  font-size: 1.1rem;
}

.theme-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  font-size: 1.2rem;
  color: var(--c-base);
  transition: opacity 0.2s;
}

.theme-toggle:hover {
  opacity: 0.7;
}

/* Dropdown Menu */
.dropdown {
  position: relative;
}

.dropdown-toggle {
  background: none;
  border: none;
  color: var(--c-accent);
  padding: 0.5rem 0.75rem;
  font-size: 15px;
  cursor: pointer;
  font-family: inherit;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background-color: var(--c-bg);
  border: 1px solid rgba(var(--c-base-rgb), 0.1);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 180px;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-10px);
  transition: opacity 0.2s, transform 0.2s, visibility 0.2s;
  z-index: 200;
}

.dropdown:hover .dropdown-menu,
.dropdown:focus-within .dropdown-menu {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.dropdown-item {
  display: block;
  padding: 0.75rem 1rem;
  color: var(--c-accent);
  width: 100%;
}

.dropdown-item:hover {
  background-color: rgba(var(--c-accent-rgb), 0.1);
  opacity: 1;
}

/* Responsive Navigation */
@media (max-width: 768px) {
  .nav-container {
    flex-wrap: wrap;
    height: auto;
    padding: 0.5rem 1rem;
    gap: 0.5rem;
  }

  .nav-links {
    order: 3;
    width: 100%;
    justify-content: center;
    padding-bottom: 0.5rem;
  }

  .nav-link {
    padding: 0.4rem 0.5rem;
    font-size: 14px;
  }
}

/* Buttons */
.button {
  background-color: var(--c-accent);
  color: var(--c-bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-weight: bold;
  font-size: 16px;
  font-family: inherit;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background-color 0.3s, opacity 0.3s;
  min-width: 100px;
}

.button:hover {
  background-color: rgba(var(--c-accent-rgb), 0.85);
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.button--secondary {
  background-color: transparent;
  border: 2px solid var(--c-accent);
  color: var(--c-accent);
}

.button--secondary:hover {
  background-color: var(--c-accent);
  color: var(--c-bg);
}

.button--small {
  padding: 4px 8px;
  font-size: 14px;
  min-width: 80px;
}

.button--large {
  padding: 12px 20px;
  font-size: 18px;
  min-width: 120px;
}

/* Inputs */
.input {
  background-color: var(--c-bg);
  color: var(--c-base);
  border: 2px solid rgba(var(--c-base-rgb), 0.2);
  border-radius: 4px;
  padding: 10px 14px;
  font-size: 16px;
  font-family: inherit;
  width: 100%;
  max-width: 400px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.input:focus {
  outline: none;
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px rgba(var(--c-accent-rgb), 0.2);
}

.input::placeholder {
  color: rgba(var(--c-base-rgb), 0.5);
}

/* Search Form */
.search-form,
#search-form {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.75rem;
  margin: 2rem auto;
  padding: 0 1rem;
  max-width: 800px;
}

@media (max-width: 600px) {
  .search-form,
  #search-form {
    flex-direction: column;
  }

  .search-form .input,
  #search-form .input {
    max-width: 100%;
  }

  .search-form .button,
  #search-form .button {
    width: 100%;
  }
}

/* Image Text Wrapper (for detail pages) */
.image-text-wrapper {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 1.5rem;
  max-width: 800px;
  margin: 0 auto 2rem;
}

.image-text-wrapper img {
  max-width: 220px;
  height: auto;
  border-radius: 10px;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .image-text-wrapper {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .image-text-wrapper img {
    margin-bottom: 1rem;
  }

  .image-text-wrapper .no-wrap-text {
    align-self: stretch;
    text-align: left;
  }
}

/* No Wrap Text */
.no-wrap-text {
  flex: 1;
  min-width: 0;
}

.no-wrap-text p {
  margin-top: 0;
  margin-bottom: 0.5em;
  max-width: none;
  line-height: 1.4em;
  font-size: 18px;
}

.no-wrap-text ul {
  list-style-type: none;
  padding-left: 0;
  margin: 0;
}

.no-wrap-text li {
  margin-bottom: 0.3em;
}

/* Track Grid */
.track-grid {
  display: grid;
  gap: 35px;
  max-width: 800px;
  margin: 2rem auto;
  justify-items: center;
  padding: 0 1rem;
}

@media (min-width: 500px) {
  .track-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 750px) {
  .track-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

/* Track Card */
.track {
  border-radius: 5px;
  max-width: 200px;
  width: 100%;
}

.track-image {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 10px;
  object-fit: cover;
  transition: transform 180ms ease-in-out;
}

.track-image:hover {
  transform: translateY(-5px) rotate(-3deg);
}

.track-content {
  margin-top: 8px;
}

.track-artist {
  color: var(--c-accent);
  font-size: 16px;
  margin: 0;
  font-weight: 500;
}

.track-name {
  font-size: 15px;
  margin: 2px 0 0;
  color: var(--c-base);
}

.track-album {
  font-size: 14px;
  margin: 2px 0 0;
  font-style: italic;
  opacity: 0.8;
}

.track-playcount {
  font-size: 14px;
  color: var(--c-base);
  opacity: 0.7;
  margin-top: 4px;
}

.track-subtitle {
  font-size: 13px;
  color: var(--c-accent);
  opacity: 0.85;
  margin-top: 4px;
  font-style: italic;
}

/* Loading Spinner */
.spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  gap: 1rem;
  color: var(--c-base);
}

.loading-text {
  font-size: 16px;
  opacity: 0.7;
}

/* Error Message */
.error-message {
  color: #e53935;
  text-align: center;
  padding: 1rem;
  background-color: rgba(229, 57, 53, 0.1);
  border-radius: 4px;
  max-width: 600px;
  margin: 1rem auto;
}

/* Footer */
.footer {
  color: var(--c-base);
  margin: 5em auto 2em;
  text-align: center;
  line-height: 1.5em;
  max-width: 800px;
  padding: 0 1rem;
  opacity: 0.7;
}

.footer p {
  font-size: 14px;
}

.footer a {
  color: var(--c-accent);
}

/* Highlight */
.highlight {
  background-color: var(--c-accent);
  color: var(--c-bg);
  padding: 0 4px;
  border-radius: 4px;
}

/* Select/Dropdown */
.select {
  background-color: var(--c-bg);
  color: var(--c-base);
  border: 2px solid var(--c-accent);
  border-radius: 4px;
  padding: 8px 32px 8px 12px;
  font-size: 16px;
  font-family: inherit;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg fill='%23FF6C00' height='24' viewBox='0 0 24 24' width='24' xmlns='http://www.w3.org/2000/svg'><path d='M7 10l5 5 5-5z'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  min-width: 150px;
}

.select:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(var(--c-accent-rgb), 0.2);
}

/* Filter Container */
.filter-container {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 1rem;
}

.filter-label {
  font-size: 14px;
  color: var(--c-base);
  opacity: 0.8;
}

/* Code Blocks */
code {
  font-family: 'SF Mono', Monaco, 'Courier New', monospace;
  background-color: rgba(var(--c-accent-rgb), 0.1);
  color: var(--c-base);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.9em;
}

pre {
  font-family: 'SF Mono', Monaco, 'Courier New', monospace;
  background-color: rgba(var(--c-accent-rgb), 0.1);
  color: var(--c-base);
  padding: 1rem;
  border-radius: 5px;
  overflow-x: auto;
  line-height: 1.6em;
  white-space: pre-wrap;
}

/* Blockquote */
blockquote {
  border-left: 3px solid var(--c-accent);
  padding: 0 1rem;
  margin: 1rem auto;
  max-width: 800px;
  font-style: italic;
}

/* Artist/Album Detail Styles */
.detail-header {
  display: flex;
  gap: 1.5rem;
  max-width: 800px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.detail-image {
  width: 200px;
  height: 200px;
  border-radius: 10px;
  object-fit: cover;
  flex-shrink: 0;
}

.detail-info {
  flex: 1;
  min-width: 0;
}

.detail-title {
  color: var(--c-accent);
  margin: 0 0 0.5rem;
  text-align: left;
}

.detail-subtitle {
  font-size: 1.2rem;
  color: var(--c-base);
  margin: 0 0 1rem;
}

.detail-meta {
  font-size: 14px;
  opacity: 0.7;
}

@media (max-width: 600px) {
  .detail-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .detail-title {
    text-align: center;
  }
}

/* Genre Tags */
.genre-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0;
}

.genre-tag {
  background-color: rgba(var(--c-accent-rgb), 0.15);
  color: var(--c-accent);
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
}

/* Streaming Links */
.streaming-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 1rem 0;
}

.streaming-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 8px 14px;
  border: 1px solid rgba(var(--c-base-rgb), 0.2);
  border-radius: 20px;
  font-size: 14px;
  transition: border-color 0.2s, background-color 0.2s;
}

.streaming-link:hover {
  border-color: var(--c-accent);
  background-color: rgba(var(--c-accent-rgb), 0.05);
  opacity: 1;
}

/* Section */
.section {
  margin: 3rem auto;
  max-width: 800px;
  padding: 0 1rem;
}

.section-title {
  margin-bottom: 1.5rem;
}

/* Card */
.card {
  background-color: rgba(var(--c-base-rgb), 0.03);
  border: 1px solid rgba(var(--c-base-rgb), 0.08);
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 800px;
  margin: 1rem auto;
}

/* AI Summary and Citations */
.ai-summary {
  max-width: 800px;
  margin: 0 auto;
}

.ai-summary p {
  margin: 0.8em 0;
  max-width: none;
}

.ai-summary > p:first-child {
  margin-top: 1.5em;
}

.ai-summary div {
  margin: 0;
}

.ai-summary ul,
.citations ul {
  margin: 0.5em 0;
  padding-left: 1.5em;
  list-style-type: disc;
}

.ai-summary li {
  font-size: 18px;
  margin-bottom: 0.5em;
  line-height: 1.4em;
}

.citations {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(var(--c-base-rgb), 0.1);
}

.citations h4 {
  margin: 0 0 0.5em;
  font-size: 14px;
  opacity: 0.8;
}

.citations li {
  font-size: 14px;
  margin-bottom: 0.3em;
}

.citation-number {
  opacity: 0.6;
}

/* Similar Artists (outside image-text-wrapper) */
#similar-artists {
  max-width: 800px;
  margin: 0 auto;
}

#similar-artists p {
  margin: 1em 0 0.2em;
  max-width: none;
}

#similar-artists ul {
  list-style-type: none;
  padding-left: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3em;
}

#similar-artists li {
  margin: 0;
}

/* Genre Grid (for genre search page) */
.genre-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 1rem;
  max-width: 800px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.genre-card {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background-color: rgba(var(--c-accent-rgb), 0.1);
  border-radius: 8px;
  text-align: center;
  font-weight: 500;
  transition: background-color 0.2s, transform 0.2s;
}

.genre-card:hover {
  background-color: rgba(var(--c-accent-rgb), 0.2);
  transform: translateY(-2px);
  opacity: 1;
}

/* Track List (for recommendations page) */
.track-list {
  max-width: 800px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.track-item {
  display: flex;
  gap: 1.25rem;
  margin-bottom: 1.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid rgba(var(--c-base-rgb), 0.1);
}

.track-item:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.track-item-image {
  width: 100px;
  height: 100px;
  flex-shrink: 0;
}

.track-item-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
}

.track-item-image .placeholder-image {
  width: 100%;
  height: 100%;
  background-color: rgba(var(--c-base-rgb), 0.1);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.track-item-content {
  flex: 1;
  min-width: 0;
}

.track-item-content p {
  margin: 0 0 0.5em;
  max-width: none;
}

.track-item-content p:last-child {
  margin-bottom: 0;
}

.track-links {
  font-size: 14px;
}

.loading-inline {
  font-style: italic;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
}

@media (max-width: 500px) {
  .track-item {
    flex-direction: column;
    gap: 0.75rem;
  }

  .track-item-image {
    width: 80px;
    height: 80px;
  }
}

/* Utility Classes */
.text-center { text-align: center; }
.text-left { text-align: left; }
.text-right { text-align: right; }
.text-muted { opacity: 0.7; }
.mt-1 { margin-top: 0.5rem; }
.mt-2 { margin-top: 1rem; }
.mt-3 { margin-top: 1.5rem; }
.mt-4 { margin-top: 2rem; }
.mb-1 { margin-bottom: 0.5rem; }
.mb-2 { margin-bottom: 1rem; }
.mb-3 { margin-bottom: 1.5rem; }
.mb-4 { margin-bottom: 2rem; }

/* Visually Hidden (for accessibility) */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`;

export default globalStyles;
