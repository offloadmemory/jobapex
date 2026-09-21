import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import type { SkillInfo } from "@shared/wire";

import { hermes } from "../lib/ipc";
import { reportError, reportInfo } from "../lib/log";
import { cn } from "../lib/utils";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Textarea } from "../components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";

/** Mirrors the main process's slug rule; the IPC layer re-validates server-side. */
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const CONTENT_PLACEHOLDER = `## When to use
Use this skill when the user asks you to cut a release.

## Steps
1. Confirm the working tree is clean with \`git status\`.
2. Bump the version in package.json.
3. Draft the changelog from \`git log\` since the last tag.

## Verification
- The changelog lists every user-facing change.
- The version bump is committed before tagging.`;

interface SkillDetail {
  name: string;
  /** null means the main process found no SKILL.md for this name. */
  text: string | null;
}

interface SkillSeed {
  /** The row being edited; its source decides whether a rename can prune a directory. */
  skill: SkillInfo;
  /** SKILL.md without its frontmatter — the dialog edits the body only. */
  body: string;
}

/** null = closed; "create" = new skill; the edit seed = that skill's form. */
type SkillDialogState = { mode: "create" } | { mode: "edit"; seed: SkillSeed };

export function SkillsView() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequest = useRef(0);

  const [dialog, setDialog] = useState<SkillDialogState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkillInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadList = useCallback(async (nextSelection?: string | null): Promise<void> => {
    setSkills(null);
    setListError(null);
    const r = await hermes.skills.list();
    if (!r.ok) {
      setSkills([]);
      setListError(r.error.message);
      reportError("skills.list", r.error.message);
      return;
    }
    setSkills(r.data);
    if (nextSelection !== undefined) setSelected(nextSelection);
  }, []);

  const loadDetail = useCallback(async (name: string): Promise<void> => {
    const request = ++detailRequest.current;
    setDetail(null);
    setDetailError(null);
    const r = await hermes.skills.read(name);
    // A newer selection landed while this read was in flight — drop the stale one.
    if (request !== detailRequest.current) return;
    if (!r.ok) {
      setDetailError(r.error.message);
      reportError("skills.read", r.error.message);
      return;
    }
    setDetail({ name, text: r.data });
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const selectSkill = (name: string): void => {
    setSelected(name);
    void loadDetail(name);
  };

  const refresh = (): void => {
    void loadList(selected);
    if (selected !== null) void loadDetail(selected);
  };

  const selectedInfo = skills?.find((s) => s.name === selected) ?? null;

  /** The dialog edits the body; frontmatter is rebuilt from name and description. */
  function openEdit() {
    if (selectedInfo === null || detail === null || detail.text === null) return;
    const body = detail.text.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/\n$/, "");
    setDialog({ mode: "edit", seed: { skill: selectedInfo, body } });
  }

  async function submitDelete() {
    if (pendingDelete === null) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await hermes.skills.remove(pendingDelete.name, pendingDelete.source);
    setDeleting(false);
    if (!result.ok) {
      setDeleteError(result.error.message);
      reportError("skills.remove", result.error.message);
      return;
    }
    reportInfo(
      "skills.remove",
      `Deleted ${pendingDelete.source} skill ${pendingDelete.name}.`
    );
    const removed = pendingDelete;
    setPendingDelete(null);
    const keepSelected = selected === removed.name ? null : selected;
    if (keepSelected === null) {
      setSelected(null);
      setDetail(null);
    }
    void loadList(keepSelected);
    if (keepSelected !== null) void loadDetail(keepSelected);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <h1 className="text-sm font-semibold tracking-tight">Skills</h1>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh skills"
            onClick={refresh}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "create" })}>
            <Plus className="size-3.5" />
            New skill
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-64 shrink-0 flex-col border-r">
          {listError !== null ? (
            <div className="space-y-2 p-4">
              <p className="text-xs text-destructive">Could not load skills: {listError}</p>
              <Button variant="outline" size="sm" onClick={() => void loadList()}>
                Retry
              </Button>
            </div>
          ) : skills === null ? (
            <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading skills…
            </div>
          ) : skills.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              No skills yet. Use “New skill” to write your first one.
            </p>
          ) : (
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-0.5 p-2">
                {skills.map((skill) => (
                  <button
                    key={`${skill.source}:${skill.name}`}
                    type="button"
                    onClick={() => selectSkill(skill.name)}
                    className={cn(
                      "rounded-md px-2.5 py-2 text-left transition-colors",
                      selected === skill.name ? "bg-muted" : "hover:bg-muted/60"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{skill.name}</span>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {skill.source}
                      </Badge>
                    </div>
                    {skill.description !== "" && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {skill.description}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {selected === null ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              Select a skill to preview its SKILL.md
            </div>
          ) : (
            <>
              <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
                <span className="text-sm font-medium">{selected}</span>
                {selectedInfo !== null && (
                  <>
                    <Badge variant="secondary" className="text-[10px]">
                      {selectedInfo.source}
                    </Badge>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                          {selectedInfo.path}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-md break-all font-mono text-xs">
                        {selectedInfo.path}
                      </TooltipContent>
                    </Tooltip>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={detail === null || detail.text === null}
                        onClick={openEdit}
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          setDeleteError(null);
                          setPendingDelete(selectedInfo);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                {detailError !== null ? (
                  <div className="space-y-2 p-4">
                    <p className="text-xs text-destructive">
                      Could not read this skill: {detailError}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void loadDetail(selected)}
                    >
                      Retry
                    </Button>
                  </div>
                ) : detail === null ? (
                  <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading SKILL.md…
                  </div>
                ) : detail.text === null ? (
                  <p className="p-4 text-xs text-muted-foreground">
                    Skill not found — “{detail.name}” has no SKILL.md on disk. Refresh to
                    update the list.
                  </p>
                ) : (
                  <ScrollArea className="h-full">
                    <pre className="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
                      {detail.text}
                    </pre>
                  </ScrollArea>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {dialog !== null && (
        <SkillDialog
          key={
            dialog.mode === "edit"
              ? `edit:${dialog.seed.skill.source}:${dialog.seed.skill.name}`
              : "create"
          }
          state={dialog}
          skills={skills}
          onClose={() => setDialog(null)}
          onSaved={(name) => {
            setDialog(null);
            void loadList(name);
            void loadDetail(name);
          }}
        />
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{pendingDelete?.name}”?</DialogTitle>
            <DialogDescription>
              The {pendingDelete?.source} skill directory and its SKILL.md are removed from
              disk, so the agent stops being offered it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError !== null && <p className="text-xs text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => void submitDelete()}
            >
              {deleting ? "Deleting…" : "Delete skill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SkillDialogProps {
  state: SkillDialogState;
  /** Current list, used to warn before an overwrite; may be null while loading. */
  skills: SkillInfo[] | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}

function SkillDialog({ state, skills, onClose, onSaved }: SkillDialogProps) {
  const editing = state.mode === "edit" ? state.seed.skill : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [content, setContent] = useState(state.mode === "edit" ? state.seed.body : "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const nameIsValid = KEBAB_CASE.test(trimmedName);
  const renamed = editing !== null && trimmedName !== editing.name;
  const existing = skills?.find((s) => s.name === trimmedName) ?? null;

  const submit = async (): Promise<void> => {
    if (!nameIsValid) {
      setFormError("Name must be kebab-case: lowercase letters, digits, single hyphens.");
      return;
    }
    if (description.trim() === "") {
      setFormError("Description must not be empty — the agent reads it to decide when to load the skill.");
      return;
    }
    setSaving(true);
    setFormError(null);
    // skills:write only writes to the user skills directory, so only a user
    // skill we are renaming has a directory the writer may prune.
    const previousName =
      editing !== null && editing.source === "user" && renamed ? editing.name : undefined;
    const result = await hermes.skills.write({
      name: trimmedName,
      description: description.trim(),
      content: content.trim(),
      previousName,
    });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error.message);
      reportError("skills.write", result.error.message);
      return;
    }
    if (previousName !== undefined) {
      reportInfo("skills.rename", `Renamed skill ${previousName} → ${trimmedName}.`);
    }
    onSaved(trimmedName);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing === null ? "New skill" : `Edit “${editing.name}”`}</DialogTitle>
          <DialogDescription>
            {editing === null
              ? "Writes a SKILL.md into your user skills directory. The agent sees its name and description in every session."
              : "Saving rewrites this skill's SKILL.md in your user skills directory; a changed name removes the previous user skill directory."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="skill-name" className="text-xs font-medium">
              Name
            </label>
            <Input
              id="skill-name"
              value={name}
              placeholder="release-notes"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setName(e.target.value);
                setFormError(null);
              }}
            />
            {trimmedName !== "" && !nameIsValid && (
              <p className="text-xs text-destructive">
                Use lowercase letters, digits, and single hyphens (e.g. release-notes).
              </p>
            )}
            {editing === null && nameIsValid && existing !== null && (
              <p className="text-xs text-muted-foreground">
                {existing.source === "user"
                  ? `A user skill named “${existing.name}” already exists — saving overwrites it.`
                  : `A project skill named “${existing.name}” exists and shadows user skills of the same name; this one will only apply outside that project.`}
              </p>
            )}
            {editing !== null && renamed && existing !== null && (
              <p className="text-xs text-destructive">
                A {existing.source} skill named “{existing.name}” already exists — saving
                overwrites it.
              </p>
            )}
            {editing !== null && editing.source === "project" && (
              <p className="text-xs text-muted-foreground">
                This is a project skill: saving writes a user skill
                {renamed ? ` named “${trimmedName}”` : ""}, while the project directory keeps
                its own copy.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="skill-description" className="text-xs font-medium">
              Description
            </label>
            <Input
              id="skill-description"
              value={description}
              placeholder="How to cut a release and publish the changelog"
              onChange={(e) => {
                setDescription(e.target.value);
                setFormError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Required — the agent reads it to decide when to load the skill.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="skill-content" className="text-xs font-medium">
              Content (SKILL.md body)
            </label>
            <Textarea
              id="skill-content"
              rows={10}
              className="font-mono text-xs"
              value={content}
              placeholder={CONTENT_PLACEHOLDER}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>

          {formError !== null && <p className="text-xs text-destructive">{formError}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()}>{saving ? "Saving…" : "Save skill"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
