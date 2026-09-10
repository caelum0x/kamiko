import { useCallback, useContext, useState, useRef, useEffect } from "react";
import Webcam from "react-webcam";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";
import { ChatContext } from "@/features/chat/chatContext";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { config } from "@/utils/config";
import { IconButton } from "./iconButton";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { clsx } from "clsx";

export function EmbeddedWebcam({
  setWebcamEnabled,
}: {
  setWebcamEnabled: (enabled: boolean) => void;
}) {
  const { chat: bot } = useContext(ChatContext);
  const { viewer } = useContext(ViewerContext);
  const webcamRef = useRef<Webcam>(null);
  /*
   * OPERATOR PUPPETEERING, driven off THIS camera rather than a second one.
   *
   * The tracker needs a <video> that is already producing frames, and this component owns the only
   * one on the stage. Opening a second getUserMedia stream for the face would be a second camera
   * light, a second permission prompt, and on most laptops a device the browser will simply refuse
   * to hand out twice.
   */
  const [tracking, setTracking] = useState(false);
  const [trackError, setTrackError] = useState("");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [cameraDisabled, setCameraDisabled] = useState(false);
  const [imageData, setImageData] = useState("");
  const [imageMode, setImageMode] = useState<"webcam" | "uploader">("webcam");
  const imgRef = useRef<HTMLImageElement>(null);

  useKeyboardShortcut("Escape", () => {
    setWebcamEnabled(false);
  });

  // Longest-side cap for a vision frame. Vision models bill ~ by resolution, so downscaling the
  // webcam frame before upload makes each /v1/vision call cheaper + faster with no quality loss that
  // matters for "describe what you see". 768px is plenty for a scene description.
  const VISION_MAX_DIM = 768;

  const processImageFromCanvas = async (data: string) => {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = data;
    });
    const srcW = img.width || imgRef.current?.width || VISION_MAX_DIM;
    const srcH = img.height || imgRef.current?.height || VISION_MAX_DIM;
    const scale = Math.min(1, VISION_MAX_DIM / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return "";
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.8).replace('data:image/jpeg;base64,', '');
  };

  useEffect(() => {
    const handleImageDataChange = async () => {
      if (imageData) {
        // Both modes go through the downscale now, so a webcam frame is capped + compressed too.
        const fixedImageData = await processImageFromCanvas(imageData);
        await bot.getVisionResponse(fixedImageData);
        setCameraDisabled(false);
        setImageData("");
        setWebcamEnabled(false);
      }
    };

    handleImageDataChange();
  }, [imageData, imageMode, bot]);

  const capture = useCallback(() => {
      if (webcamRef.current === null) {
        return;
      }

      let imageSrc = webcamRef.current.getScreenshot();
      if (imageSrc) {
        setCameraDisabled(true);
        setImageData(imageSrc);
        setImageMode('webcam');
      }
    },
    [webcamRef]
  );

  const imgFileInputRef = useRef<HTMLInputElement>(null);
  const handleClickOpenImgFile = useCallback(() => {
    imgFileInputRef.current?.click();
  }, []);

  const handleChangeImgFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.match("image.*")) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCameraDisabled(true);
        setImageMode("uploader");
        setImageData(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const toggleTracking = useCallback(async () => {
    setTrackError("");
    const model = viewer?.model;
    if (!model) {
      setTrackError("the avatar is still loading — try again in a second.");
      return;
    }
    if (tracking) {
      model.stopFaceTracking();
      setTracking(false);
      return;
    }
    const video = webcamRef.current?.video ?? null;
    if (!video) {
      setTrackError("the camera is not running yet.");
      return;
    }
    const ok = await model.startFaceTracking(video);
    setTracking(ok);
    // The five ways this fails need five different fixes, so the reason is shown rather than a
    // generic "could not start" — an operator mid-show has no time to guess which one it is.
    if (!ok) setTrackError(model.faceTrackingError() || "could not start face tracking.");
  }, [viewer, tracking]);

  /*
   * CLOSING THE CAMERA STOPS THE TRACKER. Without this, dismissing this panel leaves the detect
   * loop running against a <video> that is being torn down — which is a per-frame throw forever,
   * and an avatar whose face is frozen on the operator's last expression with no way to release it
   * short of a reload.
   */
  useEffect(() => {
    return () => {
      viewer?.model?.stopFaceTracking();
    };
  }, [viewer]);

  /*
   * AUTO-START WHEN THE DEPLOYMENT SHIPS WITH IT ON (NEXT_PUBLIC_FACE_TRACKING=true) — for the
   * operator's own build, where opening the camera IS the intent to puppeteer and a second click
   * every show is friction.
   *
   * It waits for the video to actually produce a frame: `startFaceTracking` on a <video> that has
   * not reached readyState 2 gives MediaPipe a zero-sized texture, and it fails in a way that reads
   * as a broken feature rather than as a camera that had not warmed up. One retry a second, and it
   * gives up after ten so a permanently dead camera does not poll forever.
   */
  useEffect(() => {
    if (config("face_tracking") !== "true" || tracking || cameraDisabled) return;
    let tries = 0;
    const id = setInterval(() => {
      const video = webcamRef.current?.video;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        clearInterval(id);
        void toggleTracking();
      } else if (++tries > 10) {
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [tracking, cameraDisabled, toggleTracking]);

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  };

  return (
    <div className="fixed right-[calc(320px)] top-0 z-[11]">
      <div className="fixed">
        <>
          {!cameraDisabled && (
            <Webcam
              ref={webcamRef}
              audio={false}
              width={320}
              height={240}
              screenshotFormat="image/jpeg"
              videoConstraints={{
                facingMode,
              }}
              className={clsx(
                "rounded-bl-none rounded-br-none rounded-lg bg-black",
                cameraDisabled && "animate-pulse"
              )}
            />
          )}
          {cameraDisabled && (
            <img
              ref={imgRef}
              src={imageData}
              alt="Captured image"
              width={320}
              height={240}
              className={clsx(
                "rounded-bl-none rounded-br-none rounded-lg bg-black",
                cameraDisabled && "animate-pulse",
              )}
            />
          )}
          <div className="p-1 shadow-md flex flex-auto justify-evenly bg-gray-50 rounded-tl-none rounded-tr-none rounded-full">
            <IconButton
              iconName="24/UploadAlt"
              isProcessing={false}
              className="bg-secondary hover:bg-secondary-hover active:bg-secondary-active"
              onClick={handleClickOpenImgFile}
              disabled={cameraDisabled}
            />
            <IconButton
              iconName="24/Shutter"
              isProcessing={false}
              className="bg-secondary hover:bg-secondary-hover active:bg-secondary-active"
              onClick={() => capture()}
              disabled={cameraDisabled}
            />

            <button className="pr-2 rounded-lg text-sm p-1 text-center inline-flex items-center">
              <ArrowPathIcon
                className="w-5 h-5 text-gray-700 focus:animate-spin"
                onClick={toggleFacingMode}
              />
            </button>

            {/*
              PUPPETEERING. Named for what it does to HER, not for the technology behind it: an
              operator reaching for this wants "drive her face", not "MediaPipe FaceLandmarker".
              Disabled while the camera is showing a still, because there are no frames to track.
            */}
            <button
              onClick={() => void toggleTracking()}
              disabled={cameraDisabled}
              aria-pressed={tracking}
              title={tracking ? "Stop driving her face from this camera" : "Drive her face from this camera"}
              className={clsx(
                "rounded-lg px-2 py-1 text-xs font-bold",
                tracking ? "bg-primary text-on-primary" : "bg-secondary text-[var(--npc-ash)]",
                cameraDisabled && "opacity-40",
              )}
            >
              {tracking ? "driving her" : "drive her face"}
            </button>
          </div>

          {/*
            The reason, when there is one. It is the difference between "the camera was refused",
            "the model would not download" and "this browser has no GPU delegate" — three problems
            with three different fixes, and a generic failure message would send an operator looking
            for the wrong one.
          */}
          {trackError ? (
            <p className="mt-1 max-w-[320px] rounded-lg bg-[var(--npc-window)] px-2 py-1 text-[11px] leading-snug text-[var(--npc-amber)]">
              {trackError}
            </p>
          ) : null}
        </>
      </div>
      <input
        type="file"
        className="hidden"
        accept=".jpeg, .jpg, .png, .webp, .heic"
        ref={imgFileInputRef}
        onChange={handleChangeImgFile}
      />
    </div>

  );
}
