// A template (unlike a layout) remounts on every navigation, so this
// wrapper replays the same enter animation for each route change.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter flex flex-1 flex-col">{children}</div>;
}
