import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { filterSlashItems, type SlashItem } from "./items";
import { SlashMenuList, type SlashKeyHandler } from "./SlashMenuList";

/** Notion-style `/` menu. */
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    const options: Omit<SuggestionOptions<SlashItem, SlashItem>, "editor"> = {
      char: "/",
      startOfLine: false,
      allowSpaces: false,
      placement: "bottom-start",
      offset: { mainAxis: 6, crossAxis: 0 },
      allow: ({ editor }) => editor.isEditable && !editor.isActive("codeBlock"),
      items: ({ query }) => filterSlashItems(query),
      command: ({ editor, range, props }) => props.run({ editor, range }),
      render: () => {
        let renderer: ReactRenderer | null = null;
        let unmount: (() => void) | null = null;
        let keyHandler: SlashKeyHandler | null = null;
        const register = (h: SlashKeyHandler | null) => {
          keyHandler = h;
        };
        return {
          onStart: (props) => {
            renderer = new ReactRenderer(SlashMenuList, { props: { ...props, register }, editor: props.editor });
            unmount = props.mount(renderer.element as HTMLElement);
          },
          onUpdate: (props) => renderer?.updateProps({ ...props, register }),
          onKeyDown: (props) => {
            if (props.event.key === "Escape") {
              unmount?.();
              unmount = null;
              return true;
            }
            return keyHandler?.(props) ?? false;
          },
          onExit: () => {
            unmount?.();
            unmount = null;
            renderer?.destroy();
            renderer = null;
            keyHandler = null;
          },
        };
      },
    };
    return [Suggestion({ editor: this.editor, ...options })];
  },
});
