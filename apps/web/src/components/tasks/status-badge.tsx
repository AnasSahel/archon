const STATUS_STYLES: Record<string, string> = {
  open: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  awaiting_human: "bg-orange-100 text-orange-700",
  escalated: "bg-red-100 text-red-700",
  done: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-400 line-through",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.open;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style}`}>
      {status.replace("_", " ")}
    </span>
  );
}
