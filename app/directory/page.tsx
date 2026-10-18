import { DirectoryTiles } from "@/components/directory/DirectoryTiles";

export const metadata = {
  title: "Directory",
};

export default function DirectoryPage() {
  return <DirectoryTiles directoryHref="/directory" />;
}
