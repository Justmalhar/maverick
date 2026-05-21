// HTML5 video preview with native controls.
interface Props {
  filePath: string;
}

export default function VideoPreview({ filePath }: Props) {
  return (
    <div
      data-testid="video-preview"
      className="flex h-full w-full items-center justify-center bg-black"
    >
      <video
        src={filePath}
        controls
        data-testid="video-preview-el"
        className="max-h-full max-w-full"
      />
    </div>
  );
}
