/**
 * Generates a custom GitHub stats SVG from the GitHub GraphQL API.
 * Run in CI (see .github/workflows/update-stats.yml) or locally:
 *   GH_LOGIN=TariqulislamTuhin STATS_TOKEN=<pat> npx tsx scripts/generate-stats.ts
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const OUT_PATH = "assets/github-stats.svg";
const login = process.env.GH_LOGIN ?? "TariqulislamTuhin";
const token = process.env.STATS_TOKEN ?? process.env.GITHUB_TOKEN;

if (!token) {
  throw new Error("Missing token: set STATS_TOKEN (a PAT) or GITHUB_TOKEN.");
}

interface LanguageEdge {
  size: number;
  node: { name: string; color: string | null };
}

interface RepoNode {
  stargazerCount: number;
  languages: { edges: LanguageEdge[] };
}

interface BootstrapUser {
  name: string | null;
  login: string;
  createdAt: string;
  followers: { totalCount: number };
  pullRequests: { totalCount: number };
  repositories: { nodes: RepoNode[] };
}

async function gql<T>(query: string, token: string): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "readme-stats-generator",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

const BOOTSTRAP = `query {
  user(login: "${login}") {
    name
    login
    createdAt
    followers { totalCount }
    pullRequests { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, orderBy: { field: STARGAZERS, direction: DESC }) {
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

function yearsQuery(login: string, start: number, end: number): string {
  const fields: string[] = [];
  for (let y = start; y <= end; y++) {
    fields.push(
      `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") { totalCommitContributions }`,
    );
  }
  return `query { user(login: "${login}") { ${fields.join("\n")} } }`;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Lang {
  name: string;
  pct: number;
  color: string;
}

interface Stats {
  name: string;
  login: string;
  stars: number;
  commits: number;
  pullRequests: number;
  followers: number;
  languages: Lang[];
}

function buildSvg(s: Stats): string {
  const W = 480;
  const H = 210;
  const rows: Array<[string, number]> = [
    ["Stars earned", s.stars],
    ["Total commits", s.commits],
    ["Pull requests", s.pullRequests],
    ["Followers", s.followers],
  ];
  const leftRows = rows
    .map(([label, value], i) => {
      const y = 98 + i * 32;
      return (
        `<text class="muted" x="24" y="${y}" font-size="13">${label}</text>` +
        `<text class="value num" x="224" y="${y}" font-size="15" text-anchor="end">${fmt(value)}</text>`
      );
    })
    .join("\n    ");

  const langRows = s.languages
    .map((l, i) => {
      const y = 104 + i * 23;
      const barW = Math.max(3, Math.round((l.pct / 100) * 98));
      return (
        `<text class="muted" x="252" y="${y}" font-size="12">${esc(l.name)}</text>` +
        `<rect class="track" x="332" y="${y - 9}" width="98" height="6" rx="3" />` +
        `<rect x="332" y="${y - 9}" width="${barW}" height="6" rx="3" fill="${esc(l.color)}" />` +
        `<text class="muted num" x="456" y="${y}" font-size="11" text-anchor="end">${l.pct.toFixed(0)}%</text>`
      );
    })
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.name)} GitHub statistics">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .num { font-variant-numeric: tabular-nums; }
    .title { fill: #1f2328; font-weight: 600; }
    .sub   { fill: #656d76; }
    .muted { fill: #57606a; }
    .value { fill: #1f2328; font-weight: 600; }
    .track { fill: #d0d7de; }
    .rule  { stroke: #d0d7de; }
    @media (prefers-color-scheme: dark) {
      .title, .value { fill: #e6edf3; }
      .sub   { fill: #7d8590; }
      .muted { fill: #8b949e; }
      .track { fill: #30363d; }
      .rule  { stroke: #30363d; }
    }
  </style>
  <rect width="${W}" height="${H}" fill="transparent" />
  <text class="title" x="24" y="40" font-size="17">${esc(s.name)}</text>
  <text class="sub" x="456" y="40" font-size="12" text-anchor="end">@${esc(s.login)}</text>
  <line class="rule" x1="24" y1="56" x2="456" y2="56" />
  <line class="rule" x1="240" y1="80" x2="240" y2="200" stroke-opacity="0.6" />
  <text class="sub" x="252" y="76" font-size="10" letter-spacing="1">TOP LANGUAGES</text>
  ${leftRows}
  ${langRows}
</svg>
`;
}

async function main(): Promise<void> {
  const boot = await gql<{ user: BootstrapUser | null }>(BOOTSTRAP, token!);
  if (!boot.user) {
    throw new Error(`User "${login}" not found.`);
  }
  const user = boot.user;

  const startYear = new Date(user.createdAt).getUTCFullYear();
  const endYear = new Date().getUTCFullYear();
  const years = await gql<{ user: Record<string, { totalCommitContributions: number }> }>(
    yearsQuery(login, startYear, endYear),
    token!,
  );
  const commits = Object.values(years.user).reduce(
    (sum, y) => sum + y.totalCommitContributions,
    0,
  );

  const stars = user.repositories.nodes.reduce((sum, r) => sum + r.stargazerCount, 0);

  const langTotals = new Map<string, { size: number; color: string }>();
  for (const repo of user.repositories.nodes) {
    for (const edge of repo.languages.edges) {
      const cur = langTotals.get(edge.node.name) ?? {
        size: 0,
        color: edge.node.color ?? "#8b949e",
      };
      cur.size += edge.size;
      langTotals.set(edge.node.name, cur);
    }
  }
  const totalSize = [...langTotals.values()].reduce((a, b) => a + b.size, 0) || 1;
  const languages: Lang[] = [...langTotals.entries()]
    .map(([name, v]) => ({ name, pct: (v.size / totalSize) * 100, color: v.color }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  const svg = buildSvg({
    name: user.name ?? user.login,
    login: user.login,
    stars,
    commits,
    pullRequests: user.pullRequests.totalCount,
    followers: user.followers.totalCount,
    languages,
  });

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, svg, "utf8");
  console.log(`Wrote ${OUT_PATH} — ${fmt(commits)} commits, ${fmt(stars)} stars, ${languages.length} langs.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
