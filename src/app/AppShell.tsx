import { Sidebar } from "./Sidebar";
import { NotesList } from "./NotesList";
import { EditorPane } from "./EditorPane";

export function AppShell() {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar />
      <NotesList />
      <EditorPane />
    </div>
  );
}
