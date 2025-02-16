/* eslint-disable max-len */
import { useEffect, useRef, useContext, useMemo, useState } from 'react';
import { SocketContext } from 'context/Context';

import ScrollToBottom from 'react-scroll-to-bottom';
import { useKindeAuth } from '@kinde-oss/kinde-auth-react';

import { v4 as uuid } from 'uuid';
import { throttle } from 'lodash';
import MarkdownIt from 'markdown-it';
import BadWordsNext from 'bad-words-next';
import en from 'bad-words-next/data/en.json'

import { BsArrow90DegLeft, BsArrow90DegRight } from 'react-icons/bs'

import { useChat } from 'src/context/ChatContext';
import { useAuth } from 'src/context/AuthContext';
import { useApp } from 'src/context/AppContext';

import useChatUtils from 'src/lib/chatSocket';
import MessageStatus from './MessageStatus';
import { useNotification } from 'src/lib/notification';
import {
	NEW_EVENT_DELETE_MESSAGE,
	NEW_EVENT_EDIT_MESSAGE,
	NEW_EVENT_RECEIVE_MESSAGE,
	NEW_EVENT_TYPING,
	NEW_EVENT_READ_MESSAGE,
	NEW_EVENT_SEND_FAILED
} from '../../../constants.json';
import { createBrowserNotification } from 'src/lib/browserNotification';

import chatHelper,
{
	adjustTextareaHeight,
	checkPartnerResponse,
	getTime
} from '../lib/chatHelper';

import MessageSeen from './Chat/MessageSeen';
import MessageInput from './Chat/MessageInput';
import DropDownOptions from './Chat/DropDownOption';
import PreviousMessages from './Chat/PreviousMessages';
import decryptMessage from 'src/lib/decryptMessage';


const inactiveTimeThreshold = 180000; // 3 mins delay
let senderId;
let inactiveTimeOut;

const Chat = () => {
	const { app } = useApp();
	const { playNotification } = useNotification();
	const [editing, setEditing] = useState({
		isediting: false,
		messageID: null,
	});
	const [message, setMessage] = useState('');
	// use the id so we can track what message's previousMessage is open
	const [openPreviousMessages, setOpenPreviousMessages] = useState(null);
	const [badwordChoices, setBadwordChoices] = useState({});

	const { messages: state, addMessage, updateMessage, removeMessage, receiveMessage, startReply, currentReplyMessageId, cancelReply } = useChat();
	const { authState, dispatchAuth } = useAuth();
	const { logout } = useKindeAuth();
	const socket = useContext(SocketContext);

	const { sendMessage, editMessage } = useChatUtils(socket);
	const { getMessage, handleResend, scrollToMessage } = chatHelper(state, app)

	const inputRef = useRef('');

	const [lastMessageTime, setLastMessageTime] = useState(null);

	senderId = authState.loginId;

	const md = new MarkdownIt({
		html: false,
		linkify: true,
		typographer: true,
	});

	const badwords = new BadWordsNext({ data: en })

	function logOut() {
		dispatchAuth({
			type: 'LOGOUT',
		});
		logout();
	}

	const cancelEdit = () => {
		inputRef.current.value = '';
		setEditing({ isediting: false, messageID: null });
		socket.timeout(10000).emit(NEW_EVENT_TYPING, { chatId: app.currentChatId, isTyping: false });
	};

	const sortedMessages = useMemo(
		() =>
			Object.values(state[app.currentChatId]?.messages ?? {})?.sort((a, b) => {
				const da = new Date(a.time),
					db = new Date(b.time);
				return da - db;
			}),
		[state, app.currentChatId]
	);

	const doSend = async ({ senderId, room, message, time, containsBadword, replyTo = null }) => {
		try {
			const sentMessage = await sendMessage({
				senderId,
				message,
				time,
				chatId: room,
				containsBadword,
				replyTo
			});

			addMessage({
				senderId,
				room,
				id: sentMessage.id,
				message,
				time,
				status: 'pending',
				containsBadword,
				replyTo
			});

			try {
				updateMessage(sentMessage);
			} catch {
				logOut();
				return false;
			}
		} catch (e) {
			try {
				updateMessage({
					senderId,
					room,
					id: uuid(),
					message,
					time,
					status: 'failed',
					containsBadword,
					replyTo
				});
			} catch {
				logOut();
			}

			return false;
		}

		return true;
	};

	// Here whenever user will submit message it will be send to the server
	const handleSubmit = async (e) => {
		e.preventDefault();

		socket.emit(NEW_EVENT_TYPING, { chatId: app.currentChatId, isTyping: false });
		const d = new Date();
		const message = inputRef.current.value.trim(); // Trim the message to remove the extra spaces

		if (message === '' || senderId === undefined || senderId === '123456') {
			return;
		}

		if (editing.isediting === true) {
			try {
				const messageObject = getMessage(editing.messageID, state, app)
				const oldMessage = messageObject.message;
				const editedMessage = await editMessage({
					id: editing.messageID,
					chatId: app.currentChatId,
					newMessage: message,
					oldMessage,
				});

				updateMessage({ ...editedMessage, room: app.currentChatId }, true);
			} catch (e) {
				setEditing({ isediting: false, messageID: null });
				return;
			}
			setEditing({ isediting: false, messageID: null });
		} else {
			doSend({
				senderId,
				room: app.currentChatId,
				message,
				time: d.getTime(),
				containsBadword: badwords.check(message),
				replyTo: currentReplyMessageId
			});
		}

		if (inputRef.current) {
			inputRef.current.value = '';
			setMessage('');
			inputRef.current.focus();
		}
		cancelReply()
	};

	const handleTypingStatus = throttle((e) => {
		if (e.target.value.length > 0) {
			socket.timeout(5000).emit(NEW_EVENT_TYPING, { chatId: app.currentChatId, isTyping: true });
		}
		setMessage(e.target.value);
		adjustTextareaHeight(inputRef);
		e.target.style.height = '48px';
		e.target.style.height = `${e.target.scrollHeight}px`;
	}, 500);

	const openPreviousEdit = (messageId) => {
		if (openPreviousMessages === messageId) {
			setOpenPreviousMessages(null);
		} else {
			setOpenPreviousMessages(messageId);
		}
	};


	const hideBadword = (id) => {
		setBadwordChoices({ ...badwordChoices, [id]: 'hide' });
	};

	const showBadword = (id) => {
		setBadwordChoices({ ...badwordChoices, [id]: 'show' });
	};

	// Clear chat when escape is pressed
	useEffect(() => {
		const keyDownHandler = (event) => {
			if (event.key === 'Escape' && editing.isediting) {
				event.preventDefault();
				cancelEdit();
			}
		};

		document.addEventListener('keydown', keyDownHandler);

		return () => {
			document.removeEventListener('keydown', keyDownHandler);
		};
	}, [editing]);

	useEffect(() => {
		const newMessageHandler = (message) => {
			try {
				addMessage(message);
				playNotification('newMessage');
				createBrowserNotification('You received a new message on Whisper', message.message);
			} catch {
				logOut();
			}
		};

		const deleteMessageHandler = ({ id, chatId }) => {
			removeMessage(id, chatId);
		};

		const editMessageHandler = (messageEdited) => {
			updateMessage({ ...messageEdited, room: app.currentChatId }, true);
		};
		
		const limitMessageHandler = (data) => {
			alert(data.message);
		};

		const readMessageHandler = ({ messageId, chatId }) => {
			receiveMessage(messageId, chatId)
		}

		// This is used to recive message form other user.
		socket.on(NEW_EVENT_RECEIVE_MESSAGE, newMessageHandler);
		socket.on(NEW_EVENT_DELETE_MESSAGE, deleteMessageHandler);
		socket.on(NEW_EVENT_EDIT_MESSAGE, editMessageHandler);
		socket.on(NEW_EVENT_READ_MESSAGE, readMessageHandler)
		socket.on(NEW_EVENT_SEND_FAILED, limitMessageHandler);

		return () => {
			socket.off(NEW_EVENT_RECEIVE_MESSAGE, newMessageHandler);
			socket.off(NEW_EVENT_DELETE_MESSAGE, deleteMessageHandler);
			socket.off(NEW_EVENT_EDIT_MESSAGE, editMessageHandler);
			socket.off(NEW_EVENT_READ_MESSAGE, readMessageHandler)
			socket.off(NEW_EVENT_SEND_FAILED, limitMessageHandler);
		};
	}, []);

	useEffect(() => {
		const newLastMessageTime = sortedMessages
			.filter((message) => message.senderId !== senderId)
			.pop()?.time;
		if (newLastMessageTime !== lastMessageTime) {
			setLastMessageTime(newLastMessageTime);
			clearTimeout(inactiveTimeOut);
			inactiveTimeOut = setTimeout(() => {
				checkPartnerResponse(lastMessageTime, inactiveTimeThreshold);
			}, inactiveTimeThreshold);

		}
	}, [sortedMessages]);

	useEffect(() => {
		inputRef.current.focus()
	}, [currentReplyMessageId])

	return (
		<div className="w-full md:h-[90%] min-h-[100%] pb-[25px] flex flex-col justify-between gap-6">
			<div className="max-h-[67vh]">
				<p className="text-[0.8em] font-semibold mb-[10px] mt-[20px] text-center">
					Connected with a random User
					{sortedMessages.length === 0 && ', Be the first to send {"Hello"}'}
				</p>
				<ScrollToBottom
					initialScrollBehavior="auto"
					className="h-[100%] md:max-h-full overflow-y-auto w-full scroll-smooth"
				>
					{sortedMessages.map(
						({ senderId: sender, id, message, time, status, isEdited, oldMessages, containsBadword, isRead, replyTo }) => {
							const isSender = sender.toString() === senderId.toString();
							message = decryptMessage(message)
							// original message this message is a reply to
							const repliedMessage = replyTo ? (() => {
								const messageObj = getMessage(replyTo)
								if (!messageObj) {
									return null
								}

								return {
									...messageObj,
									message: decryptMessage(messageObj.message)
								}
							})() : null

							// is this message currently being replied? 
							const hasActiveReply = currentReplyMessageId === id

							return (
								<div key={id} id={`message-${id}`} className={`
								flex flex-col gap-2 py-2 duration-500 transition-all
									${hasActiveReply ? 'bg-[#FF9F1C]/25 border-[#FF9F1C]' : ''},
									${hasActiveReply ? (isSender ? 'border-r-[3.5px]' : 'border-l-[3.5px]') : ''}`}>
								{replyTo && (
									<div
										className={`
										max-w-[80%] md:max-w-[50%] min-w-[10px] flex gap-2 items-center
											${sender.toString() === senderId.toString() ? 'self-end' : ''}
											${repliedMessage ? 'cursor-pointer' : ''}
										`}
										onClick={() => scrollToMessage(replyTo)}
									>
										<div className="truncate border-b-4 border-[#FF9F1C] p-1">
											{repliedMessage ? (
												typeof repliedMessage.message === 'string' ? (
													<div
														className="message-reply-container flex flex-nowrap items-center gap-2"
														dangerouslySetInnerHTML={{ __html: md.render(repliedMessage.message) }}
													/>
												) : (
													repliedMessage.message
												)
											) : (
												<p className="text-gray-400 uppercase text-sm italic">
													Original Message Deleted
												</p>
											)}
										</div>
										<div
											className={
												sender.toString() !== senderId.toString() ? 'order-first' : ''}
										>
											{sender.toString() === senderId.toString() ? (
												<BsArrow90DegLeft className="fill-white text-2xl" />
											) : (
												<BsArrow90DegRight className="fill-white text-2xl" />
											)}
										</div>
									</div>
								)}
									<div
										className={`w-full flex text-white relative mb-2 ${
											isSender ? 'justify-end' : 'justify-start'
										}`}
									>
										<div
											className={`flex flex-col mb-[2px] min-w-[10px] mdl:max-w-[80%] max-w-[50%] ${
												isSender ? 'items-end' : 'items-start'
											}`}
										>
											{containsBadword && !isSender && !badwordChoices[id] ? (
												<div className='flex flex-col border-red border w-full rounded-r-md p-3'>
													<p>Your buddy is trying to send you a bad word</p>
													<div className='flex w-full gap-6'>
														<span onClick={() => showBadword(id)} className='text-sm cursor-pointer'>See</span>
														<span onClick={() => hideBadword(id)} className='text-red text-sm cursor-pointer'>Hide</span>
													</div>
												</div>
											)
												:
												<>
													<div
														className={`chat bg-red p-3 break-all will-change-auto flex gap-6 items-center text ${isSender
															? 'justify-between bg-secondary rounded-l-md'
															: 'rounded-r-md'
															}`}
													>
														{typeof message === 'string' ? (
															<span dangerouslySetInnerHTML={{
																__html: md.render(
																	badwordChoices[id] === 'hide' ? badwords.filter(message) : badwordChoices[id] === 'show' ? message : message)
															}} />
														) : (
															badwordChoices[id] === 'hide' ? badwords.filter(message) : badwordChoices[id] === 'show' ? message : message
														)}

														<DropDownOptions
															isSender={
																isSender
																&& status !== 'pending'}
															id={id}
															inputRef={inputRef}
															cancelEdit={cancelEdit}
															setEditing={setEditing}
															setReplyId={startReply}
														/>
													</div>
													<div
														className={`flex gap-2 items-center ${isSender ? 'flex-row' : 'flex-row-reverse'
															}`}
													>
														<div
															className={`text-[12px] ${status === 'failed' ? 'text-red-600' : 'text-white'
																}`}
														>
															<MessageStatus
																time={getTime(time)}
																status={status ?? 'sent'}
																iAmTheSender={isSender}
																onResend={() => handleResend(id, doSend, state, app)}
															/>
														</div>
														<PreviousMessages
															id={id}
															isSender={isSender}
															isEdited={isEdited}
															openPreviousEdit={openPreviousEdit}
															openPreviousMessages={openPreviousMessages}
															oldMessages={oldMessages}
														/>
													</div>
													<MessageSeen isRead={isRead} isSender={isSender} />
												</>}
										</div>
									</div>
									</div>
							);
						}
					)}
				</ScrollToBottom>
			</div>

			<MessageInput
				message={message}
				handleTypingStatus={handleTypingStatus}
				setMessage={setMessage}
				editing={editing}
				cancelEdit={cancelEdit}
				handleSubmit={handleSubmit}
				inputRef={inputRef}
			/>
		</div>
	);
};

export default Chat;
