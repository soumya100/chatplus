"use client"
import MobileChatLayout from '@/common/MobileChatLayout'
import { FC, ReactNode, useState } from 'react'
import DashboardLayout from './DashBoardLayout'
import AvatarModal from './AvatarModal'

interface DashBoardLayoutIndexProps {
  children: ReactNode
  profileImage: string,
  profileName: string,
  profileEmail: string,
  sessionId: string,
  unseenFriendRequests: number,
  friends: User[],
  initialUnreadCounts?: Record<string, number>
  isSuperAdmin?: boolean
}

const DashBoardLayoutIndex: FC<DashBoardLayoutIndexProps> = ({ 
  children, 
  friends, 
  profileEmail, 
  profileImage, 
  profileName, 
  sessionId, 
  unseenFriendRequests,
  initialUnreadCounts = {},
  isSuperAdmin = false
}) => {
  const [openAddFriendModal, setopenAddFriendModal] = useState(false)
  const [openAvatarModal, setOpenAvatarModal] = useState(false)
  const [currentAvatar, setCurrentAvatar] = useState(profileImage)

  // handle modal open
  const handleModalStateOpen = () => {
    setopenAddFriendModal(true)
  }

  // handle modal close
  const handleModalStateClose = () => {
    setopenAddFriendModal(false)
  }

  const handleOpenAvatarModal = () => {
    setOpenAvatarModal(true)
  }

  return (
    <div 
      className='fixed inset-0 w-full flex h-full h-[100dvh] min-h-full min-h-0 overflow-hidden bg-white dark:bg-zinc-950 text-gray-900 dark:text-gray-100'
    >
      <div className="md:hidden">
        <MobileChatLayout 
          profileImage={currentAvatar}
          profileName={profileName}
          profileEmail={profileEmail}
          sessionId={sessionId}
          unseenFriendRequests={+unseenFriendRequests}
          friends={friends}
          handleModalStateOpen={handleModalStateOpen}
          openAddFriendModal={openAddFriendModal}
          initialUnreadCounts={initialUnreadCounts}
          isSuperAdmin={isSuperAdmin}
          onOpenAvatarModal={handleOpenAvatarModal}
        />
      </div>
      <DashboardLayout 
        profileImage={currentAvatar}
        profileName={profileName}
        profileEmail={profileEmail}
        sessionId={sessionId}
        unseenFriendRequests={+unseenFriendRequests}
        friends={friends}
        openAddFriendModal={openAddFriendModal}
        handleModalStateOpen={handleModalStateOpen}
        handleModalStateClose={setopenAddFriendModal}
        handleCloseButtonModal={handleModalStateClose}
        initialUnreadCounts={initialUnreadCounts}
        isSuperAdmin={isSuperAdmin}
        onOpenAvatarModal={handleOpenAvatarModal}
      />
      <aside className='h-full min-h-0 min-w-0 flex-1 w-full overflow-y-auto overscroll-contain bg-gray-50/50 dark:bg-zinc-950'>
        {children}
      </aside>

      {/* Avatar Customization Modal */}
      <AvatarModal
        isOpen={openAvatarModal}
        onClose={() => setOpenAvatarModal(false)}
        currentImage={currentAvatar}
        userName={profileName}
        userEmail={profileEmail}
        onAvatarUpdated={(newImage) => setCurrentAvatar(newImage)}
      />
    </div>
  )
}

export default DashBoardLayoutIndex
