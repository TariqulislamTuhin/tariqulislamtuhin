/**
 * Generates a custom GitHub stats SVG from the GitHub GraphQL API.
 * Run in CI (see .github/workflows/update-stats.yml) or locally:
 *   GH_LOGIN=TariqulislamTuhin STATS_TOKEN=<pat> npx tsx scripts/generate-stats.ts
 *
 * Env:
 *   STATS_TOKEN  PAT with `repo` scope for private contribution counts (falls back to GITHUB_TOKEN)
 *   GH_LOGIN     GitHub username (default: TariqulislamTuhin)
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const OUT_PATH = "assets/github-stats.svg";
const login = process.env.GH_LOGIN ?? "TariqulislamTuhin";
const token = process.env.STATS_TOKEN ?? process.env.GITHUB_TOKEN;

if (!token) {
  throw new Error("Missing token: set STATS_TOKEN (a PAT) or GITHUB_TOKEN.");
}

interface BootstrapUser {
  name: string | null;
  login: string;
  createdAt: string;
  followers: { totalCount: number };
  pullRequests: { totalCount: number };
  contributionsCollection: { contributionCalendar: { totalContributions: number } };
  repositoriesContributedTo: { totalCount: number };
}

interface YearContribution {
  totalCommitContributions: number;
  totalPullRequestReviewContributions: number;
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
    contributionsCollection { contributionCalendar { totalContributions } }
    repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, PULL_REQUEST_REVIEW], includeUserRepositories: false) { totalCount }
  }
}`;

function yearsQuery(login: string, start: number, end: number): string {
  const fields: string[] = [];
  for (let y = start; y <= end; y++) {
    fields.push(
      `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") { totalCommitContributions totalPullRequestReviewContributions }`,
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

interface Stats {
  name: string;
  login: string;
  commits: number;
  pullRequests: number;
  reviews: number;
  contributedTo: number;
  contributionsYear: number;
  followers: number;
}

/** Hand-picked core languages (declared, not byte-measured — edit to taste). */
const LANGUAGES: Array<{ name: string; color: string }> = [
  { name: "TypeScript", color: "#3178c6" },
  { name: "PHP", color: "#4F5D95" },
  { name: "Rust", color: "#dea584" },
  { name: "C#", color: "#178600" },
  { name: "Python", color: "#3572A5" },
];

function buildSvg(s: Stats): string {
  const W = 480;
  const H = 226;
  const colA: Array<[string, number]> = [
    ["Total commits", s.commits],
    ["Pull requests", s.pullRequests],
    ["Contributions (1yr)", s.contributionsYear],
  ];
  const colB: Array<[string, number]> = [
    ["PR reviews", s.reviews],
    ["Repos contributed to", s.contributedTo],
    ["Followers", s.followers],
  ];

  const cell = (label: string, value: number, labelX: number, valueX: number, y: number): string =>
    `<text class="muted" x="${labelX}" y="${y}" font-size="13">${label}</text>` +
    `<text class="value num" x="${valueX}" y="${y}" font-size="16" text-anchor="end">${fmt(value)}</text>`;

  const cellsA = colA.map(([l, v], i) => cell(l, v, 24, 224, 88 + i * 34)).join("\n    ");
  const cellsB = colB.map(([l, v], i) => cell(l, v, 256, 456, 88 + i * 34)).join("\n    ");

  let lx = 108;
  const langEls = LANGUAGES.map((l) => {
    const el =
      `<circle cx="${lx}" cy="206" r="4" fill="${esc(l.color)}" />` +
      `<text class="muted" x="${lx + 10}" y="210" font-size="12">${esc(l.name)}</text>`;
    lx += 10 + l.name.length * 7.2 + 26;
    return el;
  }).join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.name)} GitHub statistics">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .num { font-variant-numeric: tabular-nums; }
    .title { fill: #1f2328; font-weight: 600; }
    .sub   { fill: #656d76; }
    .muted { fill: #57606a; }
    .value { fill: #1f2328; font-weight: 600; }
    .rule  { stroke: #d0d7de; }
    @media (prefers-color-scheme: dark) {
      .title, .value { fill: #e6edf3; }
      .sub   { fill: #7d8590; }
      .muted { fill: #8b949e; }
      .rule  { stroke: #30363d; }
    }
  </style>
  <rect width="${W}" height="${H}" fill="transparent" />
  <text class="title" x="24" y="38" font-size="17">${esc(s.name)}</text>
  <text class="sub" x="456" y="38" font-size="12" text-anchor="end">@${esc(s.login)}</text>
  <line class="rule" x1="24" y1="54" x2="456" y2="54" />
  <line class="rule" x1="240" y1="70" x2="240" y2="168" stroke-opacity="0.6" />
  ${cellsA}
  ${cellsB}
  <line class="rule" x1="24" y1="184" x2="456" y2="184" />
  <text class="sub" x="24" y="210" font-size="10" letter-spacing="1">LANGUAGES</text>
  ${langEls}
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
  const years = await gql<{ user: Record<string, YearContribution> }>(
    yearsQuery(login, startYear, endYear),
    token!,
  );
  const yearly = Object.values(years.user);
  const commits = yearly.reduce((sum, y) => sum + y.totalCommitContributions, 0);
  const reviews = yearly.reduce((sum, y) => sum + y.totalPullRequestReviewContributions, 0);

  const svg = buildSvg({
    name: user.name ?? user.login,
    login: user.login,
    commits,
    pullRequests: user.pullRequests.totalCount,
    reviews,
    contributedTo: user.repositoriesContributedTo.totalCount,
    contributionsYear: user.contributionsCollection.contributionCalendar.totalContributions,
    followers: user.followers.totalCount,
  });

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, svg, "utf8");
  console.log(
    `Wrote ${OUT_PATH} — ${fmt(commits)} commits, ${fmt(user.pullRequests.totalCount)} PRs, ` +
      `${fmt(reviews)} reviews, ${fmt(user.repositoriesContributedTo.totalCount)} repos contributed, ` +
      `${fmt(user.contributionsCollection.contributionCalendar.totalContributions)} contributions (1yr).`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
