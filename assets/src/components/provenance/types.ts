import { FileProps, Stamp } from "../../type";

export interface ProvenanceProps {
  file: FileProps;
  cachedResult?: Stamp & { sha256_hex: string };
}

export interface ProvenanceBadgeProps {
  stamp?: Stamp;
  onClick?: () => void;
}

export interface ProvenanceModalProps {
  onClose: () => void;
  file: FileProps;
}
