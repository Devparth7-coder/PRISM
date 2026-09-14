"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface Ctx {
  reviewId?: string;
  repoId?: string;
  findingId?: string;
  setContext: (c: { reviewId?: string; repoId?: string; findingId?: string }) => void;
}

const ReviewContext = createContext<Ctx>({ setContext: () => undefined });

export function ReviewContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ reviewId?: string; repoId?: string; findingId?: string }>({});
  return <ReviewContext.Provider value={{ ...state, setContext: setState }}>{children}</ReviewContext.Provider>;
}

export function useReviewContext() {
  return useContext(ReviewContext);
}
