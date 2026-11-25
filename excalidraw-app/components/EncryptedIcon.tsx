import { Tooltip } from "@excalidraw/excalidraw/components/Tooltip";
import { shield } from "@excalidraw/excalidraw/components/icons";

export const EncryptedIcon = () => {
  return (
    <a
      className="encrypted-icon tooltip"
      href="https://plus.excalidraw.com/blog/end-to-end-encryption"
      target="_blank"
      rel="noopener"
      aria-label={"Blog post on end-to-end encryption in Excalidraw"}
    >
      <Tooltip
        label={
          "Your drawings are end-to-end encrypted so Excalidraw's servers will never see them."
        }
        long={true}
      >
        {shield}
      </Tooltip>
    </a>
  );
};
