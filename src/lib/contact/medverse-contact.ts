export const MEDVERSE_CONTACT = {
  name: "MedVerse Pakistan",
  whatsappPhoneDisplay: "03019569240",
  whatsappPhoneHref: "https://wa.me/923019569240",
  whatsappHandleHref: "https://wa.me/medversepk",
  email: "medversepakistan@gmail.com",
  mdcatChannel: "https://whatsapp.com/channel/0029VbALKkmFy72DxKuDRC0o",
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
    label: "WhatsApp (wa.me/medversepk)",
    href: MEDVERSE_CONTACT.whatsappHandleHref,
    detail: "wa.me/medversepk",
  },
  {
    id: "email",
    label: "Gmail",
    href: `mailto:${MEDVERSE_CONTACT.email}`,
    detail: MEDVERSE_CONTACT.email,
  },
  {
    id: "mdcat",
    label: "MedVerse MDCAT WhatsApp Channel",
    href: MEDVERSE_CONTACT.mdcatChannel,
  },
  {
    id: "instagram",
    label: "MedVerse Pakistan Instagram",
    href: MEDVERSE_CONTACT.instagram,
  },
  {
    id: "youtube",
    label: "MedVerse YouTube Channel",
    href: MEDVERSE_CONTACT.youtube,
  },
  {
    id: "nursing",
    label: "Medverse Nursing Channel",
    href: MEDVERSE_CONTACT.nursingChannel,
  },
  {
    id: "facebook",
    label: "MedVerse Facebook Page",
    href: MEDVERSE_CONTACT.facebook,
  },
];
