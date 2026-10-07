import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Highlighter, Italic, Link2, Link2Off, Strikethrough, Underline } from "lucide-react";
import { IconButton } from "@/components/ui";

export function EditorBubbleMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const [linkMode, setLinkMode] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      highlight: editor.isActive("highlight"),
      link: editor.isActive("link"),
      href: (editor.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  useEffect(() => {
    if (linkMode) linkRef.current?.focus();
  }, [linkMode]);

  const applyLink = () => {
    const href = linkRef.current?.value.trim() ?? "";
    if (href) editor.chain().focus().extendMarkRange("link").setLink({ href: /^https?:\/\//i.test(href) ? href : `https://${href}` }).run();
    else editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkMode(false);
  };

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor, state }) =>
        editor.isEditable && !state.selection.empty && !editor.isActive("codeBlock") && !editor.isActive("image") && !editor.isActive("audio")
      }
    >
      <div className="bubble" onMouseDown={(e) => e.preventDefault()}>
        {linkMode ? (
          <div className="flex items-center gap-1 px-1">
            <input
              ref={linkRef}
              defaultValue={active.href}
              placeholder={t("bubble.linkPlaceholder")}
              className="h-6 w-[220px] rounded-[5px] bg-control px-2 text-[12px] text-ink outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") applyLink();
                if (e.key === "Escape") setLinkMode(false);
              }}
            />
            {active.link && (
              <IconButton size="sm" title={t("bubble.removeLink")} onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkMode(false); }}>
                <Link2Off />
              </IconButton>
            )}
          </div>
        ) : (
          <>
            <IconButton size="sm" title={`${t("bubble.bold")} ⌘B`} active={active.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></IconButton>
            <IconButton size="sm" title={`${t("bubble.italic")} ⌘I`} active={active.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></IconButton>
            <IconButton size="sm" title={`${t("bubble.underline")} ⌘U`} active={active.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline /></IconButton>
            <IconButton size="sm" title={t("bubble.strike")} active={active.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></IconButton>
            <div className="mx-0.5 h-4 w-px bg-line" />
            <IconButton size="sm" title={t("bubble.highlight")} active={active.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter /></IconButton>
            <IconButton size="sm" title={t("bubble.code")} active={active.code} onClick={() => editor.chain().focus().toggleCode().run()}><Code /></IconButton>
            <IconButton size="sm" title={t("bubble.link")} active={active.link} onClick={() => setLinkMode(true)}><Link2 /></IconButton>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
