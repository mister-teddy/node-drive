import { useState, Profiler } from "react";
import { ProvenanceBadge } from "./provenance-badge";
import { ProvenanceModal } from "./provenance-modal";
import { ProvenanceProps } from "./types";

export default function Provenance({ file, cachedResult }: ProvenanceProps) {
  const [isModalVisible, setIsModalVisible] = useState(false);

  return (
    <Profiler id="Provenance" onRender={console.log}>
      <ProvenanceBadge
        stamp={cachedResult}
        onClick={() => setIsModalVisible(true)}
      />
      {isModalVisible && (
        <ProvenanceModal onClose={() => setIsModalVisible(false)} file={file} />
      )}
    </Profiler>
  );
}
