import { createContext } from 'react';

// いま効いている設定の検索クエリ（前後を削り、小文字に揃えたもの）。'' は検索していない
// という意味。<Highlight> がこれを読んで、一致する部分文字列に印を付ける。
export const SearchContext = createContext('');
