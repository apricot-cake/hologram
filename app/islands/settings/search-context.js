import { createContext } from 'react';

// The active settings-search query (trimmed + lowercased). '' means no search.
// <Highlight> reads this to mark matching substrings.
export const SearchContext = createContext('');
