export interface SharedFileProps {
  type: "shared";
  shareId: string;
}

export interface UploadedFileProps {
  type: "uploaded";
  filePath: string;
}

export type FileProps = SharedFileProps | UploadedFileProps;

export interface VerifiedStamp {
  status: "verified";
  verified_chain?: string;
  verified_timestamp?: number;
  verified_height?: number;
}

export interface PendingStamp {
  status: "pending";
  sha256_hex: string;
}

export type Stamp = VerifiedStamp | PendingStamp;

export interface ProvenanceEvent {
  action: string;
  issued_at: string;
  actors?: {
    creator_pubkey_hex?: string;
    new_owner_pubkey_hex?: string;
  };
  signatures?: {
    creator_sig_hex?: string;
    new_owner_sig_hex?: string;
  };
  ots_proof_b64?: string;
  prev_event_hash_hex?: string;
}

export interface Manifest {
  type?: string;
  artifact?: {
    sha256_hex: string;
    verified_chain?: string;
    verified_timestamp?: number;
    verified_height?: number;
  };
  events?: ProvenanceEvent[];
}

export interface OtsInfo {
  file_hash: string;
  operations: string[];
}
