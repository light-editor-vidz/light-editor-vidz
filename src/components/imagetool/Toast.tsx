import { useEffect, useState } from "react";

export interface ToastNotice {
  message: string;
  type: "info" | "success" | "error";
}

interface Props {
  notice: ToastNotice;
  onDone: () => void;
}

/** Un message passager en bas de la fenêtre, comme dans LightCutVidz et LightCutSoundz. */
export function Toast({ notice, onDone }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    let fade: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(
      () => {
        setVisible(false);
        fade = setTimeout(onDone, 300);
      },
      notice.type === "error" ? 6000 : 3500,
    );
    return () => {
      clearTimeout(timer);
      clearTimeout(fade);
    };
  }, [notice, onDone]);

  return (
    <div role="status" className={`toast toast-${notice.type} ${visible ? "toast-in" : "toast-out"}`}>
      {notice.message}
    </div>
  );
}
