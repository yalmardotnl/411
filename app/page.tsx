"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import subreddits from "@/subreddits.config";
import type { RedditPost, PostsResponse } from "@/app/api/posts/route";

const FEED_SORTS = ["hot", "new", "top", "rising"] as const;
const SEARCH_SORTS = ["relevance", "new", "top", "comments"] as const;
const TIME_FILTERS = [
  { value: "day", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
] as const;

type FeedSort = (typeof FEED_SORTS)[number];
type SearchSort = (typeof SEARCH_SORTS)[number];
type TimeFilter = (typeof TIME_FILTERS)[number]["value"];

const allTags = [...new Set(subreddits.flatMap((s) => s.tags))];
const allSubreddits = subreddits.map((s) => s.name);

function timeAgo(utc: number) {
  const diff = Date.now() / 1000 - utc;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatScore(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function CatalogPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [feedSort, setFeedSort] = useState<FeedSort>(
    (searchParams.get("sort") as FeedSort | null) ?? "hot"
  );
  const [searchSort, setSearchSort] = useState<SearchSort>(
    (searchParams.get("ssort") as SearchSort | null) ?? "relevance"
  );
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(
    (searchParams.get("t") as TimeFilter | null) ?? "day"
  );
  const [activeTags, setActiveTags] = useState<string[]>(
    searchParams.get("tags")?.split(",").filter(Boolean) ?? []
  );
  const [activeSubs, setActiveSubs] = useState<string[]>(
    searchParams.get("subs")?.split(",").filter(Boolean) ?? []
  );
  const [postSearch, setPostSearch] = useState(searchParams.get("q") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get("q") ?? "");

  const [posts, setPosts] = useState<RedditPost[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subSearch, setSubSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(postSearch), 300);
    return () => clearTimeout(timer);
  }, [postSearch]);

  // Sync state to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (feedSort !== "hot") params.set("sort", feedSort);
    if (searchSort !== "relevance") params.set("ssort", searchSort);
    if (timeFilter !== "day") params.set("t", timeFilter);
    if (activeSubs.length) params.set("subs", activeSubs.join(","));
    if (activeTags.length) params.set("tags", activeTags.join(","));
    if (debouncedSearch) params.set("q", debouncedSearch);
    const str = params.toString();
    router.replace(str ? `?${str}` : "/", { scroll: false });
  }, [feedSort, searchSort, timeFilter, activeSubs, activeTags, debouncedSearch, router]);

  const isSearchMode = debouncedSearch.length > 0;
  const activeSort = isSearchMode ? searchSort : feedSort;

  const buildParams = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams({ sort: activeSort });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (activeSort === "top") params.set("t", timeFilter);
      if (activeSubs.length) params.set("subreddits", activeSubs.join(","));
      if (activeTags.length) params.set("tags", activeTags.join(","));
      if (cursor) params.set("after", cursor);
      return params;
    },
    [activeSort, debouncedSearch, timeFilter, activeSubs, activeTags]
  );

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPosts([]);
    setAfter(null);
    try {
      const res = await fetch(`/api/posts?${buildParams()}`);
      if (!res.ok) throw new Error(`Reddit returned ${res.status}`);
      const data: PostsResponse = await res.json();
      setPosts(data.posts);
      setAfter(data.after);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  const loadMore = useCallback(async () => {
    if (!after || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/posts?${buildParams(after)}`);
      if (!res.ok) throw new Error(`Reddit returned ${res.status}`);
      const data: PostsResponse = await res.json();
      setPosts((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        return [...prev, ...data.posts.filter((p) => !ids.has(p.id))];
      });
      setAfter(data.after);
    } catch {
      // silently fail on load more — existing posts stay visible
    } finally {
      setLoadingMore(false);
    }
  }, [after, loadingMore, buildParams]);

  // Initial fetch + refetch on filter/sort change
  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && after && !loading && !loadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [after, loading, loadingMore, loadMore]);

  const toggleTag = (tag: string) =>
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );

  const toggleSub = (sub: string) =>
    setActiveSubs((prev) =>
      prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub]
    );

  const visibleSubs = allSubreddits.filter((s) =>
    s.toLowerCase().includes(subSearch.toLowerCase())
  );
  const visibleTags = allTags.filter((t) =>
    t.toLowerCase().includes(tagSearch.toLowerCase())
  );

  const currentSorts = isSearchMode ? SEARCH_SORTS : FEED_SORTS;
  const showTimeFilter = activeSort === "top";

  const sidebar = (
    <aside className="w-64 shrink-0 flex flex-col gap-6 py-6 px-4">
      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Subreddits
        </p>
        <input
          type="text"
          value={subSearch}
          onChange={(e) => setSubSearch(e.target.value)}
          placeholder="Filter subreddits…"
          className="w-full bg-zinc-800 text-zinc-200 text-xs rounded-md px-3 py-1.5 mb-2 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-600"
        />
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {visibleSubs.length === 0 ? (
            <p className="text-zinc-600 text-xs px-1">No matches</p>
          ) : (
            visibleSubs.map((sub) => (
              <button
                key={sub}
                onClick={() => toggleSub(sub)}
                className={`text-left text-sm px-2 py-1 rounded-md transition-colors ${
                  activeSubs.includes(sub)
                    ? "bg-blue-600 text-white"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                r/{sub}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800" />

      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Tags
        </p>
        <input
          type="text"
          value={tagSearch}
          onChange={(e) => setTagSearch(e.target.value)}
          placeholder="Filter tags…"
          className="w-full bg-zinc-800 text-zinc-200 text-xs rounded-md px-3 py-1.5 mb-2 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-600"
        />
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {visibleTags.length === 0 ? (
            <p className="text-zinc-600 text-xs px-1">No matches</p>
          ) : (
            visibleTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`text-left text-sm px-2 py-1 rounded-md transition-colors ${
                  activeTags.includes(tag)
                    ? "bg-violet-600 text-white"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                #{tag}
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            className="md:hidden text-zinc-400 hover:text-white mr-1"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle sidebar"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <rect y="3" width="20" height="2" rx="1" />
              <rect y="9" width="20" height="2" rx="1" />
              <rect y="15" width="20" height="2" rx="1" />
            </svg>
          </button>
          <span className="font-bold text-lg tracking-tight text-white">411</span>
          <span className="text-zinc-500 text-sm">reddit catalog</span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto w-full flex flex-1">
        <div className="hidden md:block border-r border-zinc-800 sticky top-[49px] self-start h-[calc(100vh-49px)] overflow-y-auto">
          {sidebar}
        </div>

        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 md:hidden bg-black/50"
            onClick={() => setSidebarOpen(false)}
          >
            <div
              className="absolute inset-y-0 left-0 w-64 bg-zinc-950 border-r border-zinc-800 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {sidebar}
            </div>
          </div>
        )}

        <main className="flex-1 min-w-0 px-4 md:px-6 py-6 space-y-4">
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              value={postSearch}
              onChange={(e) => setPostSearch(e.target.value)}
              placeholder="Search within 411…"
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm rounded-lg px-4 py-2 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            />
            {postSearch && (
              <button
                onClick={() => setPostSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>

          {/* Sort bar */}
          <div className="flex flex-wrap items-center gap-2">
            {isSearchMode && (
              <span className="text-xs text-zinc-500 mr-1">Sort by</span>
            )}
            {(currentSorts as readonly string[]).map((s) => (
              <button
                key={s}
                onClick={() =>
                  isSearchMode
                    ? setSearchSort(s as SearchSort)
                    : setFeedSort(s as FeedSort)
                }
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeSort === s
                    ? "bg-orange-500 text-white"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            {showTimeFilter && (
              <div className="flex flex-wrap gap-1 ml-2">
                {TIME_FILTERS.map((tf) => (
                  <button
                    key={tf.value}
                    onClick={() => setTimeFilter(tf.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      timeFilter === tf.value
                        ? "bg-orange-500/20 text-orange-400 border border-orange-500/40"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Active filter chips */}
          {(activeSubs.length > 0 || activeTags.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {activeSubs.map((sub) => (
                <button
                  key={sub}
                  onClick={() => toggleSub(sub)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-blue-600/20 text-blue-400 border border-blue-600/30 hover:bg-blue-600/30 transition-colors"
                >
                  r/{sub} <span className="text-blue-300 ml-0.5">×</span>
                </button>
              ))}
              {activeTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-violet-600/20 text-violet-400 border border-violet-600/30 hover:bg-violet-600/30 transition-colors"
                >
                  #{tag} <span className="text-violet-300 ml-0.5">×</span>
                </button>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-950/50 border border-red-800 text-red-400 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
              <span>Failed to load posts: {error}</span>
              <button
                onClick={fetchPosts}
                className="ml-4 text-red-300 hover:text-white underline text-xs"
              >
                Retry
              </button>
            </div>
          )}

          {/* Feed */}
          {loading ? (
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="bg-zinc-900 rounded-lg p-4 animate-pulse">
                  <div className="h-4 bg-zinc-800 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-zinc-800 rounded w-1/4" />
                </div>
              ))}
            </div>
          ) : !error && posts.length === 0 ? (
            <p className="text-zinc-500 text-sm py-8 text-center">
              {isSearchMode ? `No results for "${debouncedSearch}"` : "No posts found."}
            </p>
          ) : (
            <div className="space-y-2">
              {posts.map((post) => (
                <a
                  key={post.id}
                  href={post.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 bg-zinc-900 hover:bg-zinc-800 rounded-lg p-4 transition-colors group"
                >
                  <div className="flex flex-col items-center min-w-[40px] text-center shrink-0">
                    <span className="text-orange-400 font-bold text-sm">
                      {formatScore(post.score)}
                    </span>
                    <span className="text-zinc-600 text-xs">pts</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-zinc-100 text-sm font-medium leading-snug group-hover:text-white line-clamp-2">
                      {post.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <span className="text-zinc-500 text-xs">r/{post.subreddit}</span>
                      <span className="text-zinc-700 text-xs">·</span>
                      <span className="text-zinc-500 text-xs">u/{post.author}</span>
                      <span className="text-zinc-700 text-xs">·</span>
                      <span className="text-zinc-500 text-xs">{timeAgo(post.created_utc)}</span>
                      <span className="text-zinc-700 text-xs">·</span>
                      <span className="text-zinc-500 text-xs">{post.num_comments} comments</span>
                    </div>
                    <div className="flex gap-1 mt-1.5">
                      {post.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-2 py-0.5 rounded-full bg-violet-900/40 text-violet-400"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  {post.thumbnail && (
                    <div className="shrink-0 self-start">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={post.thumbnail}
                        alt=""
                        className="w-20 h-14 object-cover rounded-md bg-zinc-800"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).parentElement!.remove();
                        }}
                      />
                    </div>
                  )}
                </a>
              ))}

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="py-4 flex justify-center">
                {loadingMore && (
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-2 h-2 rounded-full bg-zinc-600 animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <CatalogPage />
    </Suspense>
  );
}
