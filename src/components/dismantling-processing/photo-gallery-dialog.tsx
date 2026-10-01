"use client";

import { Camera, CarFront, Wrench } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type PhotoTile = { id: string; label: string; kind: "vehicle" | "part" };

export function PhotoGalleryDialog({
  open,
  onOpenChange,
  title,
  tiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  tiles: PhotoTile[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {tiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 py-10 text-center text-sm text-muted-foreground">
            <Camera className="size-6" />
            No photos captured for this selection.
          </div>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {tiles.map((tile) => (
              <div
                key={tile.id}
                className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 p-2 text-center text-muted-foreground"
              >
                {tile.kind === "vehicle" ? <CarFront className="size-6" /> : <Wrench className="size-6" />}
                <span className="text-[11px] font-medium">{tile.label}</span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
