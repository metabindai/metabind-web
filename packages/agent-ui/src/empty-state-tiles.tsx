import { ThreadPrimitive } from "@assistant-ui/react";
import { cn } from "./lib/utils";
import type { FC, ReactNode } from "react";

// A configurable empty-state tile. Each tile shows an image with a title, a
// hover-revealed description, and a CTA button. Clicking anywhere on the tile
// sends `prompt` to the thread as a starter message. Supply tiles via
// `configureChat({ welcome: { tiles: [...] } })`.
export type EmptyStateTile = {
    /** Background image (URL or path served by your app). */
    image: string;
    /** Headline shown at the bottom of the tile. */
    title: ReactNode;
    /** Supporting copy, revealed on hover. */
    description?: ReactNode;
    /** Button label. */
    cta: string;
    /** Starter prompt sent to the agent when the tile is clicked. */
    prompt: string;
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
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {tiles.map((tile, i) => (
                <EmptyStateTileCard key={i} tile={tile} />
            ))}
        </div>
    );
};
