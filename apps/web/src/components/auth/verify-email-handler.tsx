"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function VerifyEmailHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Missing verification token.");
      return;
    }

    authClient.verifyEmail({ query: { token } }).then(({ error }) => {
      if (error) {
        setStatus("error");
        setMessage(error.message ?? "Verification failed.");
      } else {
        setStatus("success");
        setTimeout(() => router.push("/dashboard"), 2000);
      }
    });
  }, [token, router]);

  if (status === "loading") {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Verifying your email…
      </p>
    );
  }

  if (status === "success") {
    return (
      <div className="rounded-md bg-green-50 dark:bg-green-900/20 px-4 py-4 text-sm text-green-700 dark:text-green-400">
        Email verified! Redirecting to your dashboard…
      </div>
    );
  }

  return (
    <div className="rounded-md bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
      {message}
    </div>
  );
}
