export type SubredditConfig = {
  name: string;
  tags: string[];
};

const subreddits: SubredditConfig[] = [
  { name: "vibecoding", tags: ["vibecoded"] },
];

export default subreddits;
