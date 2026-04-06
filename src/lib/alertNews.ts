import Parser from "rss-parser";
import metascraper from "metascraper";
import metascraperImage from "metascraper-image";
import metascraperTitle from "metascraper-title";

const scraper = metascraper([metascraperImage(), metascraperTitle()]);
const parser = new Parser();

/** Google Alert RSS feeds — edit names/URLs as needed. */
export const FEED_SOURCES = [
  {
    name: "Artemis",
    url: "https://www.google.com/alerts/feeds/03293407941797645912/18272689007090524157",
  },
  {
    name: "Hockey",
    url: "https://www.google.com/alerts/feeds/03293407941797645912/7923865835966919969",
  },
  {
    name: "Apple",
    url: "https://www.google.com/alerts/feeds/03293407941797645912/2086267021858115870",
  },
  {
    name: "Anthropic",
    url: "https://www.google.com/alerts/feeds/03293407941797645912/2086267021858116001",
  },
  {
    name: "Mario Galaxy Movie",
    url: "https://www.google.com/alerts/feeds/03293407941797645912/8990605971775890245",
  },
  {
    name: "RAM Price",
    url: "https://www.google.com/alerts/feeds/03293407941797645912/5567260331040329901",
  },
];

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export type CarouselItem = {
  label: string;
  title: string;
  href: string;
  imageUrl: string | null;
  metaLine: string | null;
};

type Row = CarouselItem & { _dateMs: number };

function decodeBasicEntities(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

/** Google Alert item links are often wrappers; resolve the destination for fetch + metascraper. */
function resolveArticleUrl(link: string): string {
  try {
    const u = new URL(link);
    const nested = u.searchParams.get("url");
    if (
      (u.hostname === "www.google.com" || u.hostname === "google.com") &&
      nested
    ) {
      return nested;
    }
  } catch {
    /* keep link */
  }
  return link;
}

function cleanHeadline(raw: string | undefined): string {
  if (!raw?.trim()) return "Untitled";
  const stripped = raw.replace(/<[^>]+>/g, "");
  const decoded = decodeBasicEntities(stripped).trim();
  return decoded.split(" - ")[0]?.trim() || decoded;
}

function staticFallbackCarousel(): CarouselItem[] {
  return FEED_SOURCES.map((s) => ({
    label: "Google Alert · RSS",
    title: s.name,
    href: s.url,
    imageUrl: null,
    metaLine: null,
  }));
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function getAlertCarouselItems(): Promise<CarouselItem[]> {
  try {
    const perFeed = await Promise.all(
      FEED_SOURCES.map(async (source) => {
        try {
          const feed = await parser.parseURL(source.url);
          const items = (feed.items ?? []).slice(0, 3);
          const rows: Row[] = [];

          for (const item of items) {
            const rawLink = item.link?.trim();
            if (!rawLink) continue;
            const link = resolveArticleUrl(rawLink);

            const pub = item.pubDate ?? item.isoDate ?? null;
            const dateMs =
              pub && !Number.isNaN(new Date(pub).getTime())
                ? new Date(pub).getTime()
                : 0;

            let imageUrl: string | null = null;
            try {
              const html = await fetchHtml(link);
              if (html) {
                const metadata = await scraper({ html, url: link });
                const img = metadata.image;
                imageUrl =
                  typeof img === "string" && img.trim() ? img.trim() : null;
              }
            } catch {
              /* ignore per-article scrape errors */
            }

            const metaLine =
              pub && dateMs
                ? new Date(pub).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : null;

            rows.push({
              label: source.name,
              title: cleanHeadline(item.title),
              href: link,
              imageUrl,
              metaLine,
              _dateMs: dateMs,
            });
          }

          return rows;
        } catch {
          return [];
        }
      })
    );

    const flat = perFeed.flat();
    if (flat.length === 0) return staticFallbackCarousel();

    flat.sort((a, b) => b._dateMs - a._dateMs);
    return flat.slice(0, 6).map(({ _dateMs, ...rest }) => rest);
  } catch {
    return staticFallbackCarousel();
  }
}
