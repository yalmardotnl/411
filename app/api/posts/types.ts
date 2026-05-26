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
