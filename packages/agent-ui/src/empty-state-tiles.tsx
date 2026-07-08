import { ThreadPrimitive } from "@assistant-ui/react";
import { cn } from "./lib/utils";
import type { FC, ReactNode } from "react";

// A configurable empty-state tile. With an `image`, it renders as a rich image
// card (title + hover-revealed description + CTA). Without one, it renders as a
// compact text tile (title + optional description) — suited to prompts generated
// at runtime, where there's no artwork. Clicking anywhere on the tile sends
// `prompt` to the thread as a starter message. Supply tiles via
// `configureChat({ welcome: { tiles: [...] } })` or push them later with
// `setWelcomeTiles([...])`.
export type EmptyStateTile = {
    /** Background image (URL or path served by your app). Omit for a text tile. */
    image?: string;
    /** Headline shown at the bottom of the tile. */
    title: ReactNode;
    /** Supporting copy. Revealed on hover for image tiles; always shown for text tiles. */
    description?: ReactNode;
    /** Button label. Only rendered for image tiles. */
    cta?: string;
    /** Starter prompt sent to the agent when the tile is clicked. */
    prompt: string;
};

export type StarterTileProps = {
    /** Prompt sent to the thread (as a user message) when the tile is clicked. */
    prompt: string;
    /** Convenience content rendered in the default text-tile layout. Ignored
     *  when `children` is provided. */
    title?: ReactNode;
    description?: ReactNode;
    /** Custom content — overrides `title`/`description` for full control. */
    children?: ReactNode;
    /** Extra classes, merged with (and able to override) the default styling. */
    className?: string;
    "aria-label"?: string;
};

/**
 * A clickable starter-prompt tile. Wraps `ThreadPrimitive.Suggestion` so a click
 * sends `prompt` to the thread — the building block for custom welcome tiles
 * (`configureChat({ welcome: { renderTiles } })`) that don't want to reach into
 * assistant-ui directly. Pass `children` for a fully custom body, or
 * `title`/`description` for the default compact layout.
 */
export const StarterTile: FC<StarterTileProps> = ({
    prompt,
    title,
    description,
    children,
    className,
    "aria-label": ariaLabel,
}) => {
    return (
        <ThreadPrimitive.Suggestion
            prompt={prompt}
            send
            className={cn(
                "group/tile flex w-full flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3 text-left",
                "outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60",
                className,
            )}
            aria-label={ariaLabel ?? (typeof title === "string" ? title : prompt)}
        >
            {children ?? (
                <>
                    <span className="font-medium text-sm leading-tight text-foreground">
                        {title}
                    </span>
                    {description && (
                        <span className="text-sm leading-snug text-muted-foreground">
                            {description}
                        </span>
                    )}
                </>
            )}
        </ThreadPrimitive.Suggestion>
    );
};

const EmptyStateTileCard: FC<{ tile: EmptyStateTile }> = ({ tile }) => {
    return (
        <ThreadPrimitive.Suggestion
            prompt={tile.prompt}
            send
            className={cn(
                "group/tile relative block aspect-[16/10] w-full overflow-hidden rounded-2xl text-left",
                "outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60",
            )}
            aria-label={tile.cta}
        >
            <img
                src={tile.image}
                alt=""
                className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-in-out group-hover/tile:scale-110"
            />

            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/40 opacity-60 transition-opacity duration-700 ease-in-out group-hover/tile:opacity-100" />

            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-5 py-5 text-white">
                <div className="text-lg font-semibold leading-tight">
                    {tile.title}
                </div>

                {tile.description && (
                    <p className="grid grid-rows-[0fr] opacity-0 transition-all duration-500 ease-in-out group-hover/tile:grid-rows-[1fr] group-hover/tile:opacity-100">
                        <span className="overflow-hidden text-sm leading-snug text-white/90">
                            {tile.description}
                        </span>
                    </p>
                )}

                <span className="inline-flex w-fit items-center rounded-full bg-white/95 px-3.5 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors group-hover/tile:bg-white">
                    {tile.cta}
                </span>
            </div>
        </ThreadPrimitive.Suggestion>
    );
};

export const EmptyStateTiles: FC<{ tiles: EmptyStateTile[] }> = ({ tiles }) => {
    if (!tiles.length) return null;
    // A set with no artwork renders as a compact text-tile grid; otherwise the
    // rich image cards. (Mixed sets fall back to per-tile rendering below.)
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {tiles.map((tile, i) =>
                tile.image ? (
                    <EmptyStateTileCard key={i} tile={tile} />
                ) : (
                    <StarterTile
                        key={i}
                        prompt={tile.prompt}
                        title={tile.title}
                        description={tile.description}
                    />
                ),
            )}
        </div>
    );
};
