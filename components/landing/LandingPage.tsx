import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MemberActions } from "./MemberActions";
import { CONTACT_EMAIL, SECTION_IDS, SELF_HOST_URL } from "./sections";

const WRAP = "mx-auto w-full max-w-6xl px-6";
const DISPLAY = "font-serif font-medium tracking-[-0.015em] text-balance";
const SHOT =
  "h-auto w-full rounded-2xl border border-border shadow-xl";

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
    alt: "The Serving page: teams with how many of the coming dates are covered and who is on each",
    imageFirst: true,
  },
  {
    title: "Events and calendar",
    text: "Recurring meetings, RSVP, a Join Meeting button, reminders before each one, and a feed that subscribes into Apple or Google Calendar.",
    src: "/landing/calendar-list.png",
    alt: "The Calendar in list view: each event with its time and place, RSVP buttons and Add to Calendar",
    imageFirst: false,
  },
  {
    title: "Directory",
    text: "People and households, birthdays and anniversaries, with each member choosing what to hide.",
    src: "/landing/directory.png",
    alt: "The Directory: members, families, birthdays and anniversaries, with search",
    imageFirst: true,
  },
  {
    title: "Prayer requests",
    text: "Share a request with your group, by name or anonymously, and everyone sees what they’ve been asked to carry.",
    src: "/landing/prayer.png",
    alt: "The Prayer page: requests from the group, each with a You’re praying button, and a form to share one by name or anonymously",
    imageFirst: false,
  },
];

const ALSO_INCLUDED = [
  "Announcements, in the app",
  "Lecture and teaching library",
  "Giving links: Venmo, PayPal, Zelle. No money moves through the app.",
  "Member import from a spreadsheet",
  "Several groups per church, one sign-in",
  "Adjustable text size",
];

export function LandingPage() {
  return (
    <div className="flex flex-col text-lg leading-normal">
      <section id="top" className={`${WRAP} flex flex-wrap items-center gap-14 py-16 md:py-20`}>
        <div className="flex min-w-0 flex-[1_1_520px] flex-col items-start gap-6">
          <Eyebrow>For churches and their groups</Eyebrow>
          <h1 className={`${DISPLAY} text-[clamp(2.5rem,5.2vw,3.875rem)] leading-[1.05]`}>
            Run your church&rsquo;s groups <span className="text-secondary-foreground">in one place.</span>
          </h1>
          <p className="max-w-[580px] text-xl leading-normal text-muted-foreground md:text-2xl">
            Calendar, serving schedule, directory, announcements and prayer requests — one shared
            place for every group, instead of scattered texts, email chains and apps.
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
              render={<a href="#contact" />}
            >
              Get in touch
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_400px] justify-center">
          <Image
            src="/landing/dashboard.png"
            alt="The group dashboard: the group’s navigation, a greeting, and the next meeting with RSVP and a one-tap Zoom join"
            width={2360}
            height={1640}
            priority
            fetchPriority="high"
            sizes="(min-width: 1024px) 600px, 100vw"
            className={`${SHOT} max-w-[600px]`}
          />
        </div>
      </section>

      <section id={SECTION_IDS.features} className="scroll-mt-20 border-y border-border bg-white">
        <div className={`${WRAP} flex flex-col gap-20 py-20`}>
          <div className="flex max-w-[680px] flex-col gap-3">
            <Eyebrow rule="none">What&rsquo;s inside</Eyebrow>
            <h2 className={`${DISPLAY} text-[clamp(1.875rem,3.4vw,2.625rem)] leading-[1.1]`}>
              Everything a group needs to know, where everyone can find it.
            </h2>
          </div>
          {FEATURES.map((f) => (
            <div key={f.title} className="grid items-center gap-12 md:grid-cols-2">
              <div className="flex flex-col gap-3.5">
                <h3 className={`${DISPLAY} text-3xl leading-[1.1] md:text-[2.125rem]`}>{f.title}</h3>
                <p className="text-xl leading-relaxed text-muted-foreground">{f.text}</p>
              </div>
              <Image
                src={f.src}
                alt={f.alt}
                width={1880}
                height={1400}
                sizes="(min-width: 768px) 50vw, 100vw"
                className={`${SHOT} ${f.imageFirst ? "md:order-first" : ""}`}
              />
            </div>
          ))}
        </div>
      </section>

      <section className={`${WRAP} flex flex-col items-center gap-5 py-24 text-center`}>
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
        <div className={`${WRAP} flex flex-col gap-6 py-22`}>
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
            It isn&rsquo;t church management software. There&rsquo;s no staff workflow or giving
            ledger to administer — it&rsquo;s the shared space where the people in a group keep up
            with each other, leaders and members alike.
          </p>
        </div>
      </section>

      <section className={`${WRAP} flex flex-wrap gap-x-16 gap-y-10 py-20`}>
        <h2 className={`${DISPLAY} flex-[0_1_280px] text-[2.125rem] leading-[1.1]`}>Also included</h2>
        <ul className="grid min-w-0 flex-[1_1_560px] grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-10 text-lg">
          {ALSO_INCLUDED.map((item) => (
            <li key={item} className="border-b border-border py-3.5">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section id={SECTION_IDS.members} className="scroll-mt-20 border-y border-border bg-white">
        <div className={`${WRAP} flex flex-wrap items-center justify-between gap-8 py-18`}>
          <div className="flex min-w-0 flex-[1_1_520px] flex-col items-start gap-3">
            <Eyebrow rule="none">For members</Eyebrow>
            <h2 className={`${DISPLAY} text-[clamp(1.875rem,3.2vw,2.375rem)] leading-[1.1]`}>
              Already in a group on two42?
            </h2>
            <p className="text-xl text-muted-foreground">
              Your leader sends you a link. Open it, choose a password, and you&rsquo;re in — your
              group, its calendar and its people are waiting. Signed up before? Just sign in.
            </p>
          </div>
          <MemberActions />
        </div>
      </section>

      <section id={SECTION_IDS.open} className={`${WRAP} flex scroll-mt-20 flex-col gap-4 py-20`}>
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

      <section id="contact" className="scroll-mt-20 border-t border-border bg-white">
        <div className={`${WRAP} flex flex-col items-start gap-5 pt-20 pb-22`}>
          <h2 className={`${DISPLAY} max-w-[760px] text-[clamp(2rem,3.6vw,2.75rem)] leading-[1.1]`}>
            Bring your church&rsquo;s groups onto two42.
          </h2>
          <p className="max-w-[640px] text-xl text-muted-foreground">
            two42 started in one Sunday class, which still runs on it. We&rsquo;re onboarding
            churches one at a time right now — tell us about yours and we&rsquo;ll set up your space
            and walk your leaders through it.
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <Button
              size="lg"
              className="px-8 text-lg font-semibold"
              nativeButton={false}
              render={<a href={`mailto:${CONTACT_EMAIL}`} />}
            >
              Get in touch
            </Button>
            <span className="text-lg text-muted-foreground">{CONTACT_EMAIL}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
