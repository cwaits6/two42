import { getImageProps } from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HeroWindow } from "./HeroWindow";
import { CONTACT_EMAIL, SELF_HOST_URL } from "./sections";
import SHOTS from "./shots.json";

const WRAP = "mx-auto w-full max-w-[78rem] px-5 md:px-8";
const DISPLAY = "font-serif font-medium tracking-[-0.02em] text-balance";
const PANEL = "relative overflow-hidden rounded-[1.75rem]";
const LINK = "font-semibold text-foreground underline decoration-brand-accent decoration-2 underline-offset-4 hover:text-brand-primary-text";

const PHONE_SIZES = "(min-width: 420px) 360px, 90vw";

type ShotName = keyof typeof SHOTS;

/**
 * A screenshot in a browser frame, taken at phone width below md and at
 * desktop width above it, so its text stays readable on a phone instead of
 * shrinking a desktop page. Each capture ends under a whole tile, so the frame
 * shows all of it; shots.json holds the sizes the capture scripts recorded.
 */
function Screenshot({
  name,
  alt,
  sizes,
  dark = false,
  className,
}: {
  name: ShotName;
  alt: string;
  sizes: string;
  /** On a dark panel the frame's bar lightens so its edge stays visible. */
  dark?: boolean;
  className?: string;
}) {
  const { desktop, phone } = SHOTS[name];
  const {
    props: { srcSet: desktopSrcSet, width: desktopWidth, height: desktopHeight },
  } = getImageProps({ alt, ...desktop, src: `/landing/${name}.png`, sizes });
  const {
    props: { srcSet: phoneSrcSet, ...img },
  } = getImageProps({ alt, ...phone, src: `/landing/${name}-phone.png`, sizes: PHONE_SIZES });
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[360px] overflow-hidden rounded-[14px] shadow-[0_30px_70px_-10px_rgb(42_33_26/0.4)] md:max-w-none",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn("flex h-8 items-center gap-1.5 px-3 md:h-7", dark ? "bg-[#40342b]" : "bg-foreground")}
      >
        {/* A phone's browser has no window buttons: below md the bar is the address alone. */}
        <i className="hidden size-2 rounded-full bg-[#ec6a5e] md:block" />
        <i className="hidden size-2 rounded-full bg-[#f4bf4f] md:block" />
        <i className="hidden size-2 rounded-full bg-[#61c554] md:block" />
        <span
          className={cn(
            "flex h-5 flex-1 items-center justify-center rounded-md text-xs font-medium md:hidden",
            dark ? "bg-foreground text-background" : "bg-[#40342b] text-background",
          )}
        >
          two42.io
        </span>
      </div>
      <picture>
        <source
          media="(min-width: 768px)"
          srcSet={desktopSrcSet}
          sizes={sizes}
          width={desktopWidth}
          height={desktopHeight}
        />
        <source srcSet={phoneSrcSet} sizes={PHONE_SIZES} />
        <img {...img} alt={alt} className="block h-auto w-full" />
      </picture>
    </div>
  );
}

type Feature = { title: string; text: string; name: ShotName; alt: string; tone: string };

/** A full-width panel: words on one side, the screenshot on the other. */
function Panel(f: Feature & { dark: boolean; textFirst: boolean }) {
  return (
    <div
      className={cn(
        PANEL,
        f.tone,
        "grid items-center gap-8 px-6 py-10 md:gap-14 md:p-16",
        f.textFirst
          ? "md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
          : "md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]",
      )}
    >
      <div className={cn("flex flex-col gap-4", !f.textFirst && "md:order-last")}>
        <h3 className={`${DISPLAY} text-[clamp(2rem,4vw,3.125rem)] leading-[1.05]`}>{f.title}</h3>
        <p className="max-w-[26rem] text-xl leading-[1.45]">{f.text}</p>
      </div>
      <Screenshot
        name={f.name}
        alt={f.alt}
        dark={f.dark}
        sizes="(min-width: 1280px) 640px, 55vw"
      />
    </div>
  );
}

/** Two panels side by side, words above the screenshot. */
function Tiles({ items }: { items: Feature[] }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 md:gap-6">
      {items.map((f) => (
        <div key={f.title} className={cn(PANEL, f.tone, "flex flex-col gap-8 px-6 py-10 md:p-12")}>
          <div className="flex flex-col gap-3">
            <h3 className={`${DISPLAY} text-[clamp(1.875rem,3.2vw,2.5rem)] leading-[1.08]`}>{f.title}</h3>
            <p className="text-xl leading-[1.45] text-foreground/85">{f.text}</p>
          </div>
          <Screenshot
            name={f.name}
            alt={f.alt}
            sizes="(min-width: 1280px) 520px, 45vw"
            className="my-auto"
          />
        </div>
      ))}
    </div>
  );
}

const LARGE: (Feature & { dark: boolean; textFirst: boolean })[] = [
  {
    title: "Serving schedule",
    text: "Each team’s coming dates in one list. Members pick the ones they can take, and leaders see what’s still uncovered at a glance.",
    name: "serving",
    alt: "The Serving page: teams with how many of the coming dates are covered and who is on each",
    tone: "bg-brand-primary text-white",
    dark: false,
    textFirst: true,
  },
  {
    title: "Events and calendar",
    text: "Events that repeat, RSVP, a link to join online, reminders before each one, and a feed that subscribes into Apple or Google Calendar.",
    name: "calendar",
    alt: "The Calendar in list view: each event with its time and place, RSVP buttons and Add to Calendar",
    tone: "bg-foreground text-background",
    dark: true,
    textFirst: false,
  },
];

const PAIR: Feature[] = [
  {
    title: "Directory",
    text: "People and households, birthdays and anniversaries, all searchable by name.",
    name: "directory",
    alt: "The Directory: members, households, birthdays and anniversaries, with search",
    tone: "bg-white ring-1 ring-inset ring-border",
  },
  {
    title: "Prayer requests",
    text: "Share a request with your group, by name or anonymously, and let people know you’re praying for theirs.",
    name: "prayer",
    alt: "The Prayer page: requests from the group, each with a You’re praying button, and a form to share one by name or anonymously",
    tone: "bg-[color-mix(in_srgb,var(--color-brand-accent)_48%,var(--background))]",
  },
];

const PAIR_TWO: Feature[] = [
  {
    title: "Lessons",
    text: "Series with recordings and summaries, part by part, so a missed week is easy to catch up on.",
    name: "lessons",
    alt: "The Lessons page: the most recent lesson with its recording and summary, and the series it belongs to",
    tone: "bg-secondary",
  },
  {
    title: "Announcements",
    text: "News for the whole group, kept in one list that anyone can look back through.",
    name: "announcements",
    alt: "The Announcements page: the group’s announcements, newest first, each with its date",
    tone: "bg-white ring-1 ring-inset ring-border",
  },
];

const GIVING: Feature & { dark: boolean; textFirst: boolean } = {
  title: "Giving",
  text: "A group sets up a fund for a person or cause, and members send gifts straight to whoever it goes to.",
  name: "giving",
  alt: "The Give page: a fund, who it goes to, and the ways to send a gift",
  tone: "bg-brand-primary-text text-white",
  dark: false,
  textFirst: true,
};

const NOTES = [
  {
    title: "One sign-in",
    text: "Someone in more than one group keeps a single account and moves between them.",
  },
];

export function LandingPage() {
  return (
    <div className="flex flex-col text-lg leading-normal selection:bg-brand-accent selection:text-foreground">
      <section
        id="top"
        className="overflow-x-clip bg-[radial-gradient(75rem_40rem_at_50%_78%,#F9DFB4_0%,var(--background)_72%)]"
      >
        <div className={`${WRAP} flex flex-col items-center pt-10 pb-16 text-center md:pt-14 md:pb-24`}>
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-brand-accent-text md:text-[0.9375rem]">
            For churches and their groups
          </p>
          <h1 className={`${DISPLAY} mt-4 text-[clamp(2.625rem,7.2vw,5.5rem)] leading-[1.03]`}>
            Run your church&rsquo;s groups <span className="text-brand-primary-text md:block">in one place.</span>
          </h1>
          <p className="mt-6 max-w-[46rem] text-xl leading-snug text-muted-foreground md:text-[1.375rem]">
            Calendar, announcements, prayer requests, lessons, serving schedule, directory and giving,
            instead of scattered texts, email chains and apps.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
            <Button
              size="lg"
              className="h-14 rounded-xl px-7 text-lg font-semibold"
              nativeButton={false}
              render={<a href={`mailto:${CONTACT_EMAIL}`} />}
            >
              Ask about the pilot
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-14 rounded-xl border-2 border-foreground bg-transparent px-7 text-lg font-semibold"
              nativeButton={false}
              render={<a href="#invite" />}
            >
              Use an invite link
            </Button>
            <span className="basis-full text-base font-medium text-muted-foreground sm:basis-auto sm:pl-1">
              In a closed pilot
            </span>
          </div>
          <div className="mt-12 w-full text-left md:mt-16">
            <HeroWindow />
          </div>
        </div>
      </section>

      <section className={`${WRAP} flex flex-col gap-5 pt-16 pb-6 md:gap-6 md:pt-24`}>
        <h2 className={`${DISPLAY} mb-6 max-w-[58rem] text-[clamp(2.125rem,5vw,4rem)] leading-[1.05] md:mb-8`}>
          Everything a group needs to know, where everyone can find it.
        </h2>

        {LARGE.map((f) => (
          <Panel key={f.title} {...f} />
        ))}
        <Tiles items={PAIR} />
        <Tiles items={PAIR_TWO} />
        <Panel {...GIVING} />
      </section>

      <section className="mt-16 bg-foreground text-background md:mt-24">
        <figure className={`${WRAP} flex flex-col items-center py-20 text-center md:py-28`}>
          <blockquote
            className="max-w-[66rem] text-balance font-serif text-[clamp(1.75rem,4.2vw,3.25rem)] font-normal italic leading-[1.22] tracking-[-0.015em]"
          >
            &ldquo;They devoted themselves to the apostles&rsquo; teaching and to fellowship, to the
            breaking of bread and to prayer.&rdquo;
          </blockquote>
          <figcaption className="mt-8 flex flex-col gap-3">
            <span className="text-[0.9375rem] font-bold uppercase tracking-[0.14em] text-brand-accent">
              Acts 2:42
            </span>
            <span className="mx-auto max-w-[40rem] text-xl leading-[1.45] text-background/80">
              two42 is for groups that learn together, pray together, share a table and keep up
              with one another through the week.
            </span>
          </figcaption>
        </figure>
      </section>

      <section className={`${WRAP} grid gap-x-14 gap-y-10 py-16 md:grid-cols-2 md:py-24`}>
        {NOTES.map((n) => (
          <div key={n.title} className="flex flex-col gap-2.5">
            <h3 className={`${DISPLAY} text-[2rem] leading-[1.12]`}>{n.title}</h3>
            <p className="text-[1.1875rem] leading-normal text-muted-foreground">{n.text}</p>
          </div>
        ))}
        <div className="flex flex-col gap-2.5">
          <h3 className={`${DISPLAY} text-[2rem] leading-[1.12]`}>Open source</h3>
          <p className="text-[1.1875rem] leading-normal text-muted-foreground">
            Licensed under AGPL-3.0, so a church can see what the software does with its
            people&rsquo;s information. It can also{" "}
            <a href={SELF_HOST_URL} className={LINK}>
              host its own copy
            </a>
            .
          </p>
        </div>
      </section>

      <section id="invite" className="scroll-mt-20">
        <div
          className={`${WRAP} grid gap-x-14 gap-y-4 border-t border-border pt-12 pb-16 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:pt-14 md:pb-20`}
        >
          <h2 className={`${DISPLAY} text-[clamp(1.875rem,3vw,2.375rem)] leading-[1.1]`}>Have an invite link?</h2>
          <p className="max-w-[44rem] text-[1.1875rem] leading-[1.55] text-muted-foreground">
            Open it from the email or message it came in. A group invite asks for your name and emails
            you a link to set up your account. A household invite asks for your name and sends a
            request to your church&rsquo;s admins, who email you that link once they approve it. If
            you already have an account,{" "}
            <Link href="/login" className={LINK}>
              sign in
            </Link>{" "}
            first, then open the link again.
          </p>
        </div>
      </section>

      <section id="contact" className="scroll-mt-20 bg-brand-primary text-white">
        <div className={`${WRAP} flex flex-col items-start py-20 md:py-28`}>
          <h2 className={`${DISPLAY} max-w-[62rem] text-[clamp(2.5rem,6vw,4.75rem)] leading-[1.03]`}>
            Bring your church&rsquo;s groups onto two42.
          </h2>
          <p className="mt-6 max-w-[45rem] text-xl leading-[1.45] md:text-[1.4375rem]">
            two42 is in a closed pilot with a few groups. If you&rsquo;d like your church to join
            it, or want to hear when two42 opens to more churches, email us.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button
              size="lg"
              className="h-14 rounded-xl bg-background px-7 text-lg font-semibold text-foreground hover:bg-white"
              nativeButton={false}
              render={<a href={`mailto:${CONTACT_EMAIL}`} />}
            >
              Email us
            </Button>
            <span className="text-lg font-medium">{CONTACT_EMAIL}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
