import {
  BookOpen,
  Calendar,
  HandCoins,
  HandHelping,
  HeartHandshake,
  Home,
  Lock,
  Megaphone,
  Menu,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import styles from "./hero.module.css";
import { PlayInView } from "./PlayInView";

type Tool = {
  label: string;
  detail: string;
  icon: LucideIcon;
  /** Where the row starts, as an offset from its place in the menu: wide layout, then phone. */
  from: [x: number, y: number];
  fromPhone: [x: number, y: number];
  tilt: number;
  /** The menu leaves a space after this row. */
  gapAfter?: true;
};

// Labels, icons, order and spacing follow the signed-in menu (lib/groups/nav.ts
// and components/layout/SidebarNav.tsx); a change there lands here too.
const TOOLS: Tool[] = [
  {
    label: "Calendar",
    detail: "Tue 6:30 PM",
    icon: Calendar,
    from: [-12, -9],
    fromPhone: [-24, -34],
    tilt: -4,
  },
  {
    label: "Announcements",
    detail: "2 new",
    icon: Megaphone,
    from: [55, -3],
    fromPhone: [8, -20],
    tilt: -2.5,
    gapAfter: true,
  },
  {
    label: "Prayer",
    detail: "3 new",
    icon: HeartHandshake,
    from: [76, 5],
    fromPhone: [-30, -4],
    tilt: 3,
  },
  {
    label: "Lessons",
    detail: "Part 3 is up",
    icon: BookOpen,
    from: [7, -11],
    fromPhone: [10, 12],
    tilt: 3,
  },
  {
    label: "Serving",
    detail: "Nov 8",
    icon: HandHelping,
    from: [34, -29],
    fromPhone: [-22, 18],
    tilt: 3,
    gapAfter: true,
  },
  {
    label: "Directory",
    detail: "52 households",
    icon: Users,
    from: [74, -31],
    fromPhone: [6, 36],
    tilt: -3,
  },
  {
    label: "Give",
    detail: "Goes to Carlos",
    icon: HandCoins,
    from: [30, -11],
    fromPhone: [-28, 42],
    tilt: -3,
  },
];

const ALT = `A browser window open at two42.io. The menu lists Home, ${TOOLS.map((t) => t.label).join(", ")}. Home greets David and shows the next event with a reply of Going.`;

/** The hero's picture of the app, drawn in markup so it stays sharp and matches the menu. */
export function HeroWindow() {
  return (
    <PlayInView className={styles.stage}>
      <div className={styles.win} role="img" aria-label={ALT}>
        <div className={styles.chrome}>
          <i className={styles.dot} />
          <i className={styles.dot} />
          <i className={styles.dot} />
          <span className={styles.url}>
            <Lock />
            two42.io
          </span>
        </div>

        <div className={styles.appbar}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/two42-wordmark.svg" alt="" width={85} height={22} />
          <span className={styles.menu}>
            <Menu />
            Menu
          </span>
        </div>

        <div className={styles.body}>
          <div className={styles.side}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/two42-wordmark.svg"
              alt=""
              width={93}
              height={24}
            />
            <ul className={styles.rows}>
              <li className={`${styles.row} ${styles.home}`}>
                <Home />
                Home
              </li>
              {TOOLS.map((tool, i) => (
                <Row key={tool.label} tool={tool} index={i} />
              ))}
            </ul>
          </div>

          <div className={styles.main}>
            <p className={styles.greeting}>
              Good evening, <span>David</span>.
            </p>
            <p className={styles.today}>Tuesday, October 27</p>
            <div className={styles.event}>
              <div className={styles.date}>
                Tue<b>27</b>Oct
              </div>
              <div>
                <p className={styles.eventTitle}>Dinner and study</p>
                <p className={styles.eventMeta}>6:30 PM &middot; 10 going</p>
              </div>
              <div className={styles.reply}>
                <span>Going</span>
                <span>Maybe</span>
                <span>Can&rsquo;t go</span>
              </div>
            </div>
            <div className={styles.pair}>
              <div className={styles.mini}>
                <small>Serving</small>
                <b>You&rsquo;re greeting on Nov 8</b>
              </div>
              <div className={styles.mini}>
                <small>Lesson</small>
                <b>The Book of Acts, part 3</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PlayInView>
  );
}

function Row({ tool, index }: { tool: Tool; index: number }) {
  const Icon = tool.icon;
  const style = {
    "--dx": `${tool.from[0]}cqw`,
    "--dy": `${tool.from[1]}cqw`,
    "--px": `${tool.fromPhone[0]}cqw`,
    "--py": `${tool.fromPhone[1]}cqw`,
    "--r": `${tool.tilt}deg`,
    "--d": `${0.6 + index * 0.09}s`,
  } as CSSProperties;
  return (
    <>
      <li className={`${styles.row} ${styles.tool}`} style={style}>
        <Icon />
        {tool.label}
        <span className={styles.detail}>{tool.detail}</span>
      </li>
      {tool.gapAfter && <li className={styles.gap} />}
    </>
  );
}
