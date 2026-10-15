import { Sidebar } from "./Sidebar";
import { NotesList } from "./NotesList";
import { EditorPane } from "./EditorPane";
import { UpdateBanner } from "@/features/update/UpdateBanner";

export function AppShell() {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar />
      <NotesList />
      <EditorPane />
      <UpdateBanner />
    </div>
  );
}
