import { NextRequest, NextResponse } from "next/server";
import subreddits from "@/subreddits.config";

export type RedditPost = {
  id: string;
  title: string;
  author: string;
  subreddit: string;
  score: number;
  num_comments: number;
  url: string;
  permalink: string;
  thumbnail: string | null;
  created_utc: number;
  is_self: boolean;
  selftext: string;
  tags: string[];
};

export type PostsResponse = {
  posts: RedditPost[];
  after: string | null;
};

function mapPost(child: any, tags: string[]): RedditPost {
  const p = child.data;
  return {
    id: p.id,
    title: p.title,
    author: p.author,
    subreddit: p.subreddit,
    score: p.score,
    num_comments: p.num_comments,
    url: p.url,
    permalink: `https://reddit.com${p.permalink}`,
    thumbnail: p.thumbnail?.startsWith("http") ? p.thumbnail : null,
    created_utc: p.created_utc,
    is_self: p.is_self,
    selftext: p.selftext,
    tags,
  };
}

function isVisible(p: RedditPost) {
  return (
    p.title !== "[deleted]" &&
    p.title !== "[removed]" &&
    p.author !== "[deleted]"
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sort = searchParams.get("sort") || "hot";
  const t = searchParams.get("t") || "day";
  const q = searchParams.get("q")?.trim() ?? "";
  const after = searchParams.get("after") ?? "";
  const filterSubreddits = searchParams.get("subreddits")?.split(",").filter(Boolean) ?? [];
  const filterTags = searchParams.get("tags")?.split(",").filter(Boolean) ?? [];

  let targets = subreddits;
  if (filterSubreddits.length > 0) {
    targets = targets.filter((s) => filterSubreddits.includes(s.name));
  }
  if (filterTags.length > 0) {
    targets = targets.filter((s) => s.tags.some((tag) => filterTags.includes(tag)));
  }
  if (targets.length === 0) return NextResponse.json({ posts: [], after: null });

  const tagsByName = Object.fromEntries(targets.map((s) => [s.name.toLowerCase(), s.tags]));
  const timeParam = sort === "top" ? `&t=${t}` : "";
  const afterParam = after ? `&after=${after}` : "";

  if (q) {
    const multiSub = targets.map((s) => s.name).join("+");
    const url = `https://www.reddit.com/r/${multiSub}/search.json?q=${encodeURIComponent(q)}&restrict_sr=on&sort=${sort}&limit=25${timeParam}${afterParam}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "reddit-catalog/1.0" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return NextResponse.json({ posts: [], after: null }, { status: res.status });
    const json = await res.json();
    const posts = (json.data?.children ?? [])
      .map((child: any) => mapPost(child, tagsByName[child.data.subreddit?.toLowerCase()] ?? []))
      .filter(isVisible);
    return NextResponse.json({ posts, after: json.data?.after ?? null });
  }

  // Single subreddit: use cursor pagination
  // Multiple subreddits: fetch up to 100 each, no cursor (merging cursors across subs is impractical)
  const isSingle = targets.length === 1;
  const limit = isSingle ? 25 : 50;

  const fetchSub = async (sub: typeof subreddits[0]) => {
    const cursorParam = isSingle ? afterParam : "";
    const url = `https://www.reddit.com/r/${sub.name}/${sort}.json?limit=${limit}${timeParam}${cursorParam}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "reddit-catalog/1.0" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return { posts: [], after: null };
    const json = await res.json();
    const posts = (json.data?.children ?? [])
      .map((child: any) => mapPost(child, sub.tags))
      .filter(isVisible);
    return { posts, after: (json.data?.after ?? null) as string | null };
  };

  const results = await Promise.all(targets.map(fetchSub));
  const posts: RedditPost[] = results.flatMap((r) => r.posts);

  if (!isSingle && sort !== "new") {
    posts.sort((a, b) => b.score - a.score);
  }

  const nextAfter = isSingle ? results[0]?.after ?? null : null;
  return NextResponse.json({ posts, after: nextAfter });
}
