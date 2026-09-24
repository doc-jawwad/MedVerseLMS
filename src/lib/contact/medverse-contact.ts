export const MEDVERSE_CONTACT = {
  name: "MedVerse Pakistan",
  whatsappPhoneDisplay: "03019569240",
  whatsappPhoneHref: "https://wa.me/923019569240",
  whatsappHandleHref: "https://wa.me/medversepk",
  email: "medversepakistan@gmail.com",
  mdcatChannel: "https://whatsapp.com/channel/0029Vb6XYzXDTkJw6YgfVY2u",
  /** Official MedVerse WhatsApp Channel (owner-canonical). */
  medverseWhatsappChannel:
    "https://whatsapp.com/channel/0029VbALKkmFy72DxKuDRC0o",
  instagram:
    "https://www.instagram.com/medverse_pakistan?igsh=MTRjZTl3cWFsNndpdQ==",
  youtube: "https://youtube.com/@medversepakistan-dradnan?si=mW6t1YzmKYfx9-HH",
  nursingChannel: "https://whatsapp.com/channel/0029Vb86c9u1CYoSr2yVDG3W",
  facebook: "https://www.facebook.com/share/1AnskoSjZL/",
} as const;

export type ContactLink = {
  id: string;
  label: string;
  href: string;
  detail?: string;
};

export const MEDVERSE_CONTACT_LINKS: ContactLink[] = [
  {
    id: "whatsapp-phone",
    label: "WhatsApp",
    href: MEDVERSE_CONTACT.whatsappPhoneHref,
    detail: MEDVERSE_CONTACT.whatsappPhoneDisplay,
  },
  {
    id: "whatsapp-handle",
    label: "WhatsApp",
    href: MEDVERSE_CONTACT.whatsappHandleHref,
    detail: "@medversepk",
  },
  {
    id: "email",
    label: "Email",
    href: `mailto:${MEDVERSE_CONTACT.email}`,
    detail: MEDVERSE_CONTACT.email,
  },
  {
    id: "medverse-whatsapp-channel",
    label: "MedVerse WhatsApp Channel",
    href: MEDVERSE_CONTACT.medverseWhatsappChannel,
    detail: "Official MedVerse updates channel",
  },
  {
    id: "mdcat",
    label: "MDCAT WhatsApp Channel",
    href: MEDVERSE_CONTACT.mdcatChannel,
    detail: "MedVerse MDCAT updates",
  },
  {
    id: "instagram",
    label: "Instagram",
    href: MEDVERSE_CONTACT.instagram,
    detail: "@medverse_pakistan",
  },
  {
    id: "youtube",
    label: "YouTube",
    href: MEDVERSE_CONTACT.youtube,
    detail: "MedVerse Pakistan",
  },
  {
    id: "nursing",
    label: "Nursing Channel",
    href: MEDVERSE_CONTACT.nursingChannel,
    detail: "WhatsApp channel for nursing updates",
  },
  {
    id: "facebook",
    label: "Facebook",
    href: MEDVERSE_CONTACT.facebook,
    detail: "MedVerse Pakistan",
  },
];
