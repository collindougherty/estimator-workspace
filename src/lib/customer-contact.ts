export type CustomerContact = {
  address: string
  email: string
  phone: string
}

const customerContactPrefix = '__customer_contact__='

const normalizeValue = (value: string | null | undefined) => value?.trim() ?? ''

export const hasCustomerContact = (contact: CustomerContact) =>
  Boolean(
    normalizeValue(contact.address) ||
      normalizeValue(contact.email) ||
      normalizeValue(contact.phone),
  )

export const buildProjectNotesWithCustomerContact = ({
  notes,
  contact,
}: {
  notes?: string | null
  contact: CustomerContact
}) => {
  const normalizedNotes = normalizeValue(notes)

  if (!hasCustomerContact(contact)) {
    return normalizedNotes || undefined
  }

  const payload = JSON.stringify({
    address: normalizeValue(contact.address),
    email: normalizeValue(contact.email),
    phone: normalizeValue(contact.phone),
  })
  const header = `${customerContactPrefix}${payload}`

  return normalizedNotes ? `${header}\n\n${normalizedNotes}` : header
}

export const parseProjectCustomerContact = ({
  address,
  email,
  phone,
  notes,
}: {
  address?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
}): CustomerContact => {
  const normalizedAddress = normalizeValue(address)
  const normalizedEmail = normalizeValue(email)
  const normalizedPhone = normalizeValue(phone)

  if (normalizedAddress || normalizedEmail || normalizedPhone) {
    return {
      address: normalizedAddress,
      email: normalizedEmail,
      phone: normalizedPhone,
    }
  }

  const firstLine = notes?.split('\n')[0]?.trim()

  if (!firstLine?.startsWith(customerContactPrefix)) {
    return {
      address: '',
      email: '',
      phone: '',
    }
  }

  try {
    const parsed = JSON.parse(firstLine.slice(customerContactPrefix.length)) as {
      address?: string
      email?: string
      phone?: string
    }

    return {
      address: normalizeValue(parsed.address),
      email: normalizeValue(parsed.email),
      phone: normalizeValue(parsed.phone),
    }
  } catch {
    return {
      address: '',
      email: '',
      phone: '',
    }
  }
}
