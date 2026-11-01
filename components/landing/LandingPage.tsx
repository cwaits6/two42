import { getImageProps } from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CONTACT_EMAIL, SELF_HOST_URL } from "./sections";

const WRAP = "mx-auto w-full max-w-6xl px-6";
const DISPLAY = "font-serif font-medium tracking-[-0.015em] text-balance";
const SHOT =
  "h-auto w-full rounded-2xl border border-border shadow-xl";

const DESKTOP = { width: 1880, height: 1400 };
const PHONE = { width: 780, height: 1280 };
const PHONE_SIZES = "(min-width: 420px) 360px, 90vw";

/**
 * A screenshot taken at phone width below md and at desktop width above it,
 * so its text stays readable on a phone instead of shrinking a desktop page.
 */
function Screenshot({
  src,
  phoneSrc,
  alt,
  desktop = DESKTOP,
  sizes,
  priority = false,
  className,
}: {
  src: string;
  phoneSrc: string;
  alt: string;
  desktop?: { width: number; height: number };
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const common = { alt, priority, ...(priority ? { fetchPriority: "high" as const } : {}) };
  const {
    props: { srcSet: desktopSrcSet, width: desktopWidth, height: desktopHeight },
  } = getImageProps({ ...common, ...desktop, src, sizes });
  const {
    props: { srcSet: phoneSrcSet, ...img },
  } = getImageProps({ ...common, ...PHONE, src: phoneSrc, sizes: PHONE_SIZES });
  return (
    <picture className={cn("mx-auto block w-full max-w-[360px] md:max-w-none", className)}>
      <source
        media="(min-width: 768px)"
        srcSet={desktopSrcSet}
        sizes={sizes}
        width={desktopWidth}
        height={desktopHeight}
      />
      <source srcSet={phoneSrcSet} sizes={PHONE_SIZES} />
      <img {...img} alt={alt} className={SHOT} />
    </picture>
  );
}

function Eyebrow({ children, rule = "left" }: { children: React.ReactNode; rule?: "left" | "both" | "none" }) {
  const bar = <span aria-hidden="true" className="inline-block h-0.5 w-7 bg-brand-accent" />;
  return (
    <p className="inline-flex items-center gap-3 text-base font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {rule !== "none" && bar}
      {children}
      {rule === "both" && bar}
    </p>
  );
}

const FEATURES = [
  {
    title: "Serving schedule",
    text: "Each team’s coming dates in one list. Members pick the ones they can take, and leaders see what’s still uncovered at a glance.",
    src: "/landing/serving.png",
    phoneSrc: "/landing/serving-phone.png",
    alt: "The Serving page: teams with how many of the coming dates are covered and who is on each",
    imageFirst: true,
  },
  {
    title: "Events and calendar",
    text: "Events that repeat, RSVP, a link to join online, reminders before each one, and a feed that subscribes into Apple or Google Calendar.",
    src: "/landing/calendar-list.png",
    phoneSrc: "/landing/calendar-phone.png",
    alt: "The Calendar in list view: each event with its time and place, RSVP buttons and Add to Calendar",
    imageFirst: false,
  },
  {
    title: "Directory",
    text: "People and households, birthdays and anniversaries, with each member choosing what to hide.",
    src: "/landing/directory.png",
    phoneSrc: "/landing/directory-phone.png",
    alt: "The Directory: members, families, birthdays and anniversaries, with search",
    imageFirst: true,
  },
  {
    title: "Prayer requests",
    text: "Share a request with your group, by name or anonymously, and let people know you’re praying for theirs.",
    src: "/landing/prayer.png",
    phoneSrc: "/landing/prayer-phone.png",
    alt: "The Prayer page: requests from the group, each with a You’re praying button, and a form to share one by name or anonymously",
    imageFirst: false,
  },
];

export function LandingPage() {
  return (
    <div className="flex flex-col text-lg leading-normal">
      <section id="top" className={`${WRAP} flex flex-wrap items-center gap-10 py-12 md:gap-14 md:py-20`}>
        <div className="flex min-w-0 flex-[1_1_520px] flex-col items-start gap-6">
          <Eyebrow>For churches and their groups</Eyebrow>
          <h1 className={`${DISPLAY} text-[clamp(2.5rem,5.2vw,3.875rem)] leading-[1.05]`}>
            Run your church&rsquo;s groups <span className="text-secondary-foreground">in one place.</span>
          </h1>
          <p className="max-w-[580px] text-xl leading-normal text-muted-foreground md:text-2xl">
            Calendar, serving schedule, directory, announcements, prayer requests and giving — one
            shared place for every group, instead of scattered texts, email chains and apps.
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <Button
              size="lg"
              className="px-8 text-lg font-semibold"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              Sign in
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="border-2 border-foreground bg-transparent px-7 text-lg font-semibold"
              nativeButton={false}
              render={<a href="#invite" />}
            >
              Use an invite link
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_400px] justify-center">
          <Screenshot
            src="/landing/dashboard.png"
            phoneSrc="/landing/dashboard-phone.png"
            alt="The group dashboard: a greeting and the next event, with RSVP and a button to join online"
            desktop={{ width: 2360, height: 1640 }}
            sizes="(min-width: 1024px) 600px, 100vw"
            priority
            className="md:max-w-[600px]"
          />
        </div>
      </section>

      <section id="invite" className="scroll-mt-20 border-y border-border bg-card">
        <div className={`${WRAP} flex flex-col items-start gap-4 py-12 md:py-16`}>
          <h2 className={`${DISPLAY} text-[clamp(1.875rem,3.4vw,2.625rem)] leading-[1.1]`}>
            Have an invite link?
          </h2>
          <p className="max-w-[680px] text-xl leading-relaxed text-muted-foreground">
            Open it from the email or message it came in. It names the group or household you&rsquo;re
            invited to, asks for your name, and emails you a link to set up your account. If you
            already have an account, sign in first, then open the link again.
          </p>
        </div>
      </section>

      <section className="border-b border-border">
        <div className={`${WRAP} flex flex-col gap-14 py-14 md:gap-20 md:py-20`}>
          <div className="flex max-w-[680px] flex-col gap-3">
            <Eyebrow rule="none">What&rsquo;s inside</Eyebrow>
            <h2 className={`${DISPLAY} text-[clamp(1.875rem,3.4vw,2.625rem)] leading-[1.1]`}>
              Everything a group needs to know, where everyone can find it.
            </h2>
          </div>
          {FEATURES.map((f) => (
            <div key={f.title} className="grid items-center gap-6 md:grid-cols-2 md:gap-12">
              <div className="flex flex-col gap-3.5">
                <h3 className={`${DISPLAY} text-3xl leading-[1.1] md:text-[2.125rem]`}>{f.title}</h3>
                <p className="text-xl leading-relaxed text-muted-foreground">{f.text}</p>
              </div>
              <Screenshot
                src={f.src}
                phoneSrc={f.phoneSrc}
                alt={f.alt}
                sizes="(min-width: 768px) 50vw, 100vw"
                className={f.imageFirst ? "md:order-first" : ""}
              />
            </div>
          ))}
        </div>
      </section>

      <section className={`${WRAP} flex flex-col items-center gap-5 py-16 text-center md:py-24`}>
        <figure className="flex flex-col items-center gap-5">
          <blockquote
            className={`${DISPLAY} max-w-[920px] text-[clamp(1.625rem,3vw,2.375rem)] italic leading-[1.3]`}
          >
            &ldquo;They devoted themselves to the apostles&rsquo; teaching and to fellowship, to the
            breaking of bread and to prayer.&rdquo;
          </blockquote>
          <figcaption>
            <Eyebrow rule="both">Acts 2:42</Eyebrow>
          </figcaption>
        </figure>
      </section>

      <section className="bg-foreground text-background">
        <div className={`${WRAP} flex flex-col gap-6 py-16 md:py-22`}>
          <h2 className={`${DISPLAY} max-w-[880px] text-[clamp(2rem,3.6vw,2.75rem)] leading-[1.1]`}>
            Everything in one place
          </h2>
          <p className="max-w-[880px] text-xl leading-relaxed md:text-2xl">
            Communication for a church&rsquo;s groups is usually scattered across texts, email chains,
            and whatever app each leader happens to like. two42 gives every group one shared
            calendar, roster and schedule that stays current for everyone in it — and one sign-in
            for a member who belongs to more than one group.
          </p>
          <p className="max-w-[880px] text-xl leading-relaxed md:text-2xl">
            It&rsquo;s the shared space where the people in a group keep up with each other, leaders
            and members alike. Giving works the same way: a group sets up a fund for a person or
            cause, and members send gifts straight to whoever it goes to.
          </p>
        </div>
      </section>

      <section className={`${WRAP} flex flex-col gap-4 py-14 md:py-20`}>
        <h2 className={`${DISPLAY} text-[2.125rem] leading-[1.1]`}>Open source</h2>
        <p className="max-w-[760px] text-xl leading-relaxed text-muted-foreground">
          two42 is open source under AGPL-3.0, so a church never has to wonder what the software
          does with its people&rsquo;s information. The hosted service at two42.io keeps updates,
          backups and email delivery handled for you; if your church would rather run it on its own
          accounts, the{" "}
          <a
            href={SELF_HOST_URL}
            className="font-semibold text-foreground underline underline-offset-4 hover:text-secondary-foreground"
          >
            self-host guide
          </a>{" "}
          walks through it.
        </p>
      </section>

      <section id="contact" className="scroll-mt-20 border-t border-border bg-card">
        <div className={`${WRAP} flex flex-col items-start gap-5 pt-14 pb-16 md:pt-20 md:pb-22`}>
          <h2 className={`${DISPLAY} max-w-[760px] text-[clamp(2rem,3.6vw,2.75rem)] leading-[1.1]`}>
            Bring your church&rsquo;s groups onto two42.
          </h2>
          <p className="max-w-[640px] text-xl text-muted-foreground">
            We&rsquo;re setting up churches one at a time. Tell us about yours, and we&rsquo;ll set
            up your space and walk your leaders through it.
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <Button
              size="lg"
              className="px-8 text-lg font-semibold"
              nativeButton={false}
              render={<a href={`mailto:${CONTACT_EMAIL}`} />}
            >
              Email us
            </Button>
            <span className="text-lg text-muted-foreground">{CONTACT_EMAIL}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
