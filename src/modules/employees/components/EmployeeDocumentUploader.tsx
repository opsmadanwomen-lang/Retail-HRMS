import { useMemo, useState } from "react";
import { FileText, Upload, Pencil, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  useEmployeeDocuments,
  useUploadEmployeeDocument,
} from "@/hooks/useEmployeeDocuments";
import { useAuth } from "@/hooks/useAuth";
import { employeeDocumentService } from "@/services/employeeDocumentService";
import { toast } from "@/components/ui/use-toast";
import { formatDate } from "@/lib/utils";
import {
  REQUIRED_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
} from "@/constants/documentTypes";
import type { EmployeeDocumentType } from "@/types/database.types";
import type { EmployeeDocument } from "@/types/employee";

const DOCUMENT_TYPE_OPTIONS: Array<{
  value: EmployeeDocumentType;
  label: string;
}> = [
  { value: "aadhaar", label: "Aadhaar" },
  { value: "pan", label: "PAN" },
  { value: "address_proof", label: "Address Proof" },
  { value: "photo", label: "Photograph" },
  { value: "resume", label: "Resume" },
  { value: "joining_letter", label: "Joining Form" },
  { value: "appointment_letter", label: "Appointment Letter" },
  {
    value: "certificate",
    label: "Educational / Experience Certificate",
  },
  { value: "other", label: "Other" },
];

interface EmployeeDocumentUploaderProps {
  employeeId: string;
  companyId: string;
  uploadedBy?: string;
}

export function EmployeeDocumentUploader({
  employeeId,
  companyId,
  uploadedBy,
}: EmployeeDocumentUploaderProps) {
  const { user } = useAuth();

  const { data: documents, isLoading } =
    useEmployeeDocuments(employeeId);

  const upload = useUploadEmployeeDocument();

  const [documentType, setDocumentType] =
    useState<EmployeeDocumentType>("aadhaar");

  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);

  const [documentNumber, setDocumentNumber] = useState("");

  const [expiryDate, setExpiryDate] = useState("");

  const [notes, setNotes] = useState("");

  const [editingDocument, setEditingDocument] =
    useState<EmployeeDocument | null>(null);

  const canManageDocuments =
    user?.role === "super_admin" ||
    user?.role === "company_admin";

  const sortedDocuments = useMemo(
    () =>
      (documents ?? [])
        .slice()
        .sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        ),
    [documents]
  );

  const docsByType = useMemo(() => {
    const map = new Map<string, EmployeeDocument>();

    (documents ?? []).forEach((doc) => {
      map.set(doc.documentType, doc);
    });

    return map;
  }, [documents]);

  /**
   * Reset form fields.
   *
   * NOTE:
   * documentType is reset to Aadhaar only when
   * opening the general "+ Add Document" button.
   *
   * For a specific document upload, openCreateDialog()
   * will set the requested document type AFTER reset.
   */
  const resetForm = () => {
    setSelectedFile(null);
    setDocumentNumber("");
    setExpiryDate("");
    setNotes("");
    setDocumentType("aadhaar");
    setEditingDocument(null);
  };

  /**
   * Open general Add Document dialog.
   *
   * If a document type is supplied, that type will
   * automatically be selected.
   *
   * Example:
   * openCreateDialog("photo")
   * => Document Type will show Photograph.
   */
  const openCreateDialog = (
    preselectedType?: EmployeeDocumentType
  ) => {
    resetForm();

    if (preselectedType) {
      setDocumentType(preselectedType);
    }

    setIsDialogOpen(true);
  };

  /**
   * Open existing document in edit/update mode.
   *
   * The existing document type is automatically selected.
   */
  const openEditDialog = (doc: EmployeeDocument) => {
    setEditingDocument(doc);

    setDocumentType(doc.documentType);

    setDocumentNumber(doc.documentNumber ?? "");

    setExpiryDate(doc.expiryDate ?? "");

    setNotes(doc.notes ?? "");

    setSelectedFile(null);

    setIsDialogOpen(true);
  };

  /**
   * Upload / Update document.
   */
  const handleSubmit = async () => {
    if (!selectedFile && !editingDocument) {
      toast({
        title: "Please select a document",
        description: "Please choose a file before uploading.",
        variant: "destructive",
      });

      return;
    }

    try {
      if (editingDocument) {
        await upload.mutateAsync({
          companyId,
          employeeId,
          documentType,
          file: selectedFile as File,
          documentNumber:
            documentNumber || undefined,
          expiryDate:
            expiryDate || undefined,
          notes,
          uploadedBy,
          replaceDocumentId:
            editingDocument.id,
        });

        toast({
          title: "Document updated",
          variant: "success",
        });
      } else {
        await upload.mutateAsync({
          companyId,
          employeeId,
          documentType,
          file: selectedFile as File,
          documentNumber:
            documentNumber || undefined,
          expiryDate:
            expiryDate || undefined,
          notes,
          uploadedBy,
        });

        toast({
          title: "Document uploaded",
          variant: "success",
        });
      }

      setIsDialogOpen(false);

      resetForm();
    } catch (error) {
      toast({
        title: editingDocument
          ? "Update failed"
          : "Upload failed",
        description:
          error instanceof Error
            ? error.message
            : "Please try again.",
        variant: "destructive",
      });
    }
  };

  /**
   * Open/download/view document.
   */
  const handleDownload = async (
    storagePath: string
  ) => {
    try {
      const url =
        await employeeDocumentService.getSignedUrl(
          storagePath
        );

      window.open(
        url,
        "_blank",
        "noopener,noreferrer"
      );
    } catch (error) {
      toast({
        title: "Could not open document",
        description:
          error instanceof Error
            ? error.message
            : "Please try again.",
        variant: "destructive",
      });
    }
  };

  /**
   * Get document status based on expiry date.
   */
  const getDocumentStatus = (
    doc: EmployeeDocument
  ) => {
    if (!doc.expiryDate) {
      return {
        label: "No Expiry",
        variant: "secondary" as const,
      };
    }

    const today = new Date();

    const expiry = new Date(doc.expiryDate);

    const diff = Math.ceil(
      (expiry.getTime() - today.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    if (diff < 0) {
      return {
        label: "Expired",
        variant: "destructive" as const,
      };
    }

    if (diff <= 30) {
      return {
        label: "Expiring Soon",
        variant: "warning" as const,
      };
    }

    return {
      label: "Valid",
      variant: "success" as const,
    };
  };

  return (
    <div className="space-y-4">

      {/* HEADER */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          Documents
        </div>

        <Button
          type="button"
          onClick={() => openCreateDialog()}
          disabled={
            upload.isPending ||
            !canManageDocuments
          }
        >
          <Upload className="mr-2 h-4 w-4" />
          + Add Document
        </Button>

      </div>

      {/* ADD / UPDATE DOCUMENT DIALOG */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);

          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">

          <DialogHeader>

            <DialogTitle>
              {editingDocument
                ? "Update Document"
                : "Add Document"}
            </DialogTitle>

            <DialogDescription>
              {editingDocument
                ? "Replace the file and update the details below."
                : "Add a new document for this employee."}
            </DialogDescription>

          </DialogHeader>

          <div className="space-y-4 py-2">

            {/* DOCUMENT TYPE */}
            <div className="space-y-1.5">

              <Label>
                Document Type
              </Label>

              <Select
                value={documentType}
                onValueChange={(value) =>
                  setDocumentType(
                    value as EmployeeDocumentType
                  )
                }
              >

                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>

                  {DOCUMENT_TYPE_OPTIONS.map(
                    (option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </SelectItem>
                    )
                  )}

                </SelectContent>

              </Select>

            </div>

            {/* DOCUMENT NUMBER */}
            <div className="space-y-1.5">

              <Label>
                Document Number
              </Label>

              <Input
                placeholder="Enter document number"
                value={documentNumber}
                onChange={(e) =>
                  setDocumentNumber(
                    e.target.value
                  )
                }
              />

            </div>

            {/* FILE */}
            <div className="space-y-1.5">

              <Label>
                {editingDocument
                  ? "Replace File"
                  : "Document File"}
              </Label>

              <Input
                type="file"
                onChange={(e) =>
                  setSelectedFile(
                    e.target.files?.[0] ??
                      null
                  )
                }
              />

              {editingDocument &&
                !selectedFile && (
                  <p className="text-xs text-muted-foreground">
                    Keeping the current file will
                    preserve the existing document.
                  </p>
                )}

            </div>

            {/* EXPIRY DATE */}
            <div className="space-y-1.5">

              <Label>
                Expiry Date
              </Label>

              <Input
                type="date"
                value={expiryDate}
                onChange={(e) =>
                  setExpiryDate(
                    e.target.value
                  )
                }
              />

            </div>

            {/* NOTES */}
            <div className="space-y-1.5">

              <Label>
                Notes
              </Label>

              <Textarea
                placeholder="Add notes or remarks"
                value={notes}
                onChange={(e) =>
                  setNotes(e.target.value)
                }
              />

            </div>

          </div>

          <DialogFooter>

            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setIsDialogOpen(false)
              }
            >
              Cancel
            </Button>

            <Button
              onClick={handleSubmit}
              disabled={
                upload.isPending ||
                (!editingDocument &&
                  !selectedFile)
              }
            >
              {upload.isPending
                ? "Saving…"
                : editingDocument
                ? "Update Document"
                : "Upload Document"}
            </Button>

          </DialogFooter>

        </DialogContent>
      </Dialog>

      {/* DOCUMENT TABLE */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading documents…
        </p>
      ) : (
        <div className="overflow-x-auto">

          <Table>

            <TableHeader>

              <TableRow>

                <TableHead>
                  Document Type
                </TableHead>

                <TableHead>
                  Document No.
                </TableHead>

                <TableHead>
                  File
                </TableHead>

                <TableHead>
                  Expiry Date
                </TableHead>

                <TableHead>
                  Status
                </TableHead>

                <TableHead>
                  Actions
                </TableHead>

              </TableRow>

            </TableHeader>

            <TableBody>

              {/* REQUIRED DOCUMENTS */}
              {REQUIRED_DOCUMENT_TYPES.map(
                (type) => {

                  const doc =
                    docsByType.get(type);

                  const label =
                    DOCUMENT_TYPE_LABELS[type] ??
                    type.replace(
                      /_/g,
                      " "
                    );

                  {/* EXISTING DOCUMENT */}
                  if (doc) {

                    const status =
                      getDocumentStatus(doc);

                    return (
                      <TableRow
                        key={doc.id}
                      >

                        <TableCell className="font-medium">
                          {label}
                        </TableCell>

                        <TableCell>
                          {doc.documentNumber ??
                            "—"}
                        </TableCell>

                        <TableCell>
                          {doc.fileName}
                        </TableCell>

                        <TableCell>
                          {doc.expiryDate
                            ? formatDate(
                                doc.expiryDate
                              )
                            : "—"}
                        </TableCell>

                        <TableCell>
                          <Badge
                            variant={
                              status.variant
                            }
                          >
                            {status.label}
                          </Badge>
                        </TableCell>

                        <TableCell>

                          <div className="flex gap-2">

                            {/* VIEW */}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleDownload(
                                  doc.storagePath
                                )
                              }
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View
                            </Button>

                            {/* UPDATE */}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                openEditDialog(
                                  doc
                                )
                              }
                              disabled={
                                !canManageDocuments
                              }
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Update
                            </Button>

                          </div>

                        </TableCell>

                      </TableRow>
                    );
                  }

                  {/* MISSING DOCUMENT */}
                  return (
                    <TableRow
                      key={type}
                    >

                      <TableCell className="font-medium">
                        {label}
                      </TableCell>

                      <TableCell>
                        —
                      </TableCell>

                      <TableCell className="text-muted-foreground">
                        Missing
                      </TableCell>

                      <TableCell>
                        —
                      </TableCell>

                      <TableCell>
                        <Badge variant="warning">
                          Pending
                        </Badge>
                      </TableCell>

                      <TableCell>

                        <Button
                          size="sm"
                          onClick={() =>
                            openCreateDialog(
                              type as EmployeeDocumentType
                            )
                          }
                          disabled={
                            !canManageDocuments
                          }
                        >
                          + Upload
                        </Button>

                      </TableCell>

                    </TableRow>
                  );
                }
              )}

              {/* EXTRA DOCUMENTS */}
              {(sortedDocuments ?? [])
                .filter(
                  (doc) =>
                    !REQUIRED_DOCUMENT_TYPES.includes(
                      doc.documentType
                    )
                )
                .map((doc) => {

                  const status =
                    getDocumentStatus(doc);

                  const label =
                    DOCUMENT_TYPE_LABELS[
                      doc.documentType
                    ] ??
                    doc.documentType.replace(
                      /_/g,
                      " "
                    );

                  return (
                    <TableRow
                      key={doc.id}
                    >

                      <TableCell className="font-medium">
                        {label}
                      </TableCell>

                      <TableCell>
                        {doc.documentNumber ??
                          "—"}
                      </TableCell>

                      <TableCell>
                        {doc.fileName}
                      </TableCell>

                      <TableCell>
                        {doc.expiryDate
                          ? formatDate(
                              doc.expiryDate
                            )
                          : "—"}
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant={
                            status.variant
                          }
                        >
                          {status.label}
                        </Badge>
                      </TableCell>

                      <TableCell>

                        <div className="flex gap-2">

                          {/* VIEW */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              handleDownload(
                                doc.storagePath
                              )
                            }
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View
                          </Button>

                          {/* UPDATE */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              openEditDialog(
                                doc
                              )
                            }
                            disabled={
                              !canManageDocuments
                            }
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Update
                          </Button>

                        </div>

                      </TableCell>

                    </TableRow>
                  );
                })}

            </TableBody>

          </Table>

        </div>
      )}

    </div>
  );
}